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

  it("realizes a written option when it is purchased to close", () => {
    const lots = computeRealizedLots([
      {
        ...sell("short-open", "2025-01-02", 1, 378.78),
        name: "PUT S & P 500 - SOLDTOOPEN",
        quantity: 1,
      },
      {
        ...buy("short-close", "2025-01-03", 1, 101.22),
        name: "PUT S & P 500 - PURCHASETOCLOSE",
      },
    ]);

    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      position: "short",
      proceeds: 378.78,
      basis: 101.22,
    });
    expect(lots[0].gain).toBeCloseTo(277.56);
  });

  it("closes long and short options at zero when they expire", () => {
    const longOpen = { ...buy("long-open", "2025-01-02", 1, 301.22), name: "PURCHASETOOPEN" };
    const shortOpen = {
      ...sell("short-open", "2025-01-02", 1, 123.78),
      name: "SOLDTOOPEN",
      quantity: 1,
    };
    const expiredLong: LedgerTxn = {
      ...sell("long-expiry", "2025-01-03", 1, 0),
      name: "OPTIONEXPIRATION",
      type: "transfer",
    };
    const expiredShort: LedgerTxn = {
      ...buy("short-expiry", "2025-01-03", 1, 0),
      name: "OPTIONEXPIRATION",
      type: "transfer",
    };

    const lots = computeRealizedLots([longOpen, shortOpen, expiredLong, expiredShort]);
    expect(lots).toHaveLength(2);
    expect(lots.find((l) => l.position === "long")?.gain).toBe(-301.22);
    expect(lots.find((l) => l.position === "short")?.gain).toBe(123.78);
  });

  it("uses stored option cash amounts without applying a second contract multiplier", () => {
    const lots = computeRealizedLots([
      { ...buy("o", "2025-01-02", 1, 301.22), name: "PURCHASETOOPEN", price: 3 },
      { ...sell("c", "2025-01-03", 1, 808.78), name: "SOLDTOCLOSE", price: 8.1 },
    ]);
    expect(lots[0].gain).toBeCloseTo(507.56);
  });

  it("splits SPXW Section 1256 gain 60% long-term and 40% short-term", () => {
    const ticker = "SPXW250103P06000000";
    const lots = computeRealizedLots([
      { ...buy("o", "2025-01-02", 1, 300), ticker, name: "PURCHASETOOPEN" },
      { ...sell("c", "2025-01-03", 1, 800), ticker, name: "SOLDTOCLOSE" },
    ]);
    expect(lots[0].section1256).toBe(true);
    expect(summarize(lots)).toMatchObject({ shortTerm: 200, longTerm: 300, total: 500 });
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
