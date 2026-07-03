import { describe, it, expect } from "vitest";
import {
  computeRealizedLots,
  methodForTicker,
  summarize,
  summarizeByYear,
  type LedgerTxn,
} from "@/lib/tax-lots";

const buy = (id: string, date: string, qty: number, total: number): LedgerTxn => ({
  id,
  date,
  type: "buy",
  quantity: qty,
  amount: total,
  price: total / qty,
  fees: 0,
  ticker: "AAA",
});
const sell = (id: string, date: string, qty: number, proceeds: number): LedgerTxn => ({
  id,
  date,
  type: "sell",
  quantity: -qty,
  amount: -proceeds,
  price: proceeds / qty,
  fees: 0,
  ticker: "AAA",
});

describe("methodForTicker", () => {
  it("resolves sym → global → FIFO default", () => {
    expect(methodForTicker({ "sym:AAA": "LIFO" }, "aaa")).toBe("LIFO");
    expect(methodForTicker({ "*": "specid" }, "ZZZ")).toBe("specid");
    expect(methodForTicker({}, "AAA")).toBe("FIFO");
    expect(methodForTicker({ "sym:AAA": "bogus" }, "AAA")).toBe("FIFO");
  });
});

describe("computeRealizedLots", () => {
  const ledger: LedgerTxn[] = [
    buy("b1", "2024-01-01", 10, 100), // $10/sh
    buy("b2", "2024-06-01", 10, 200), // $20/sh
    sell("s1", "2025-02-01", 10, 300), // $30/sh
  ];

  it("matches FIFO by default (oldest lot, long-term)", () => {
    const [lot, ...rest] = computeRealizedLots(ledger);
    expect(rest).toHaveLength(0);
    expect(lot.buyTxnId).toBe("b1");
    expect(lot.basis).toBe(100);
    expect(lot.proceeds).toBe(300);
    expect(lot.gain).toBe(200);
    expect(lot.term).toBe("long"); // held ~397 days
    expect(lot.washSale).toBe(false);
  });

  it("matches LIFO when configured (newest lot, short-term)", () => {
    const [lot] = computeRealizedLots(ledger, { "sym:AAA": "LIFO" });
    expect(lot.buyTxnId).toBe("b2");
    expect(lot.basis).toBe(200);
    expect(lot.gain).toBe(100);
    expect(lot.term).toBe("short"); // held ~245 days
  });

  it("flags a wash sale: a realized loss with a repurchase within 30 days", () => {
    const lots = computeRealizedLots([
      buy("b1", "2025-01-01", 10, 200),
      sell("s1", "2025-02-01", 10, 100), // -$100 loss
      buy("b2", "2025-02-10", 10, 110), // repurchase 9 days later
    ]);
    expect(lots).toHaveLength(1);
    expect(lots[0].gain).toBe(-100);
    expect(lots[0].washSale).toBe(true);
  });

  it("ignores untickered and zero-quantity rows", () => {
    const lots = computeRealizedLots([
      { ...buy("b1", "2024-01-01", 10, 100), ticker: null },
      sell("s1", "2024-02-01", 10, 300),
    ]);
    expect(lots).toHaveLength(0); // sell has no lot to match
  });
});

describe("summaries", () => {
  it("rolls lots into short/long totals and disallowed wash losses", () => {
    const lots = computeRealizedLots([
      buy("b1", "2025-01-01", 10, 200),
      sell("s1", "2025-02-01", 10, 100),
      buy("b2", "2025-02-10", 10, 110),
    ]);
    const s = summarize(lots);
    expect(s.shortTerm).toBe(-100);
    expect(s.longTerm).toBe(0);
    expect(s.total).toBe(-100);
    expect(s.disallowedWash).toBe(100);
    expect(s.lots).toBe(1);
  });

  it("groups realized lots by close-year, newest first", () => {
    const years = summarizeByYear([
      ...computeRealizedLots([buy("b1", "2023-01-01", 10, 100), sell("s1", "2023-06-01", 10, 150)]),
      ...computeRealizedLots([buy("b2", "2025-01-01", 10, 100), sell("s2", "2025-06-01", 10, 120)]),
    ]);
    expect(years.map((y) => y.year)).toEqual([2025, 2023]);
  });
});
