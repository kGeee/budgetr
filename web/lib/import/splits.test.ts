import { describe, it, expect } from "vitest";
import { applySplits, type StockSplit } from "@/lib/import/splits";
import { computeRealizedLots, summarize, type LedgerTxn } from "@/lib/tax-lots";

const AAPL_4FOR1: StockSplit = { ticker: "AAPL", date: "2020-08-31", numerator: 4, denominator: 1 };

describe("applySplits", () => {
  it("restates a pre-split trade into post-split terms (qty ×4, price ÷4, amount unchanged)", () => {
    const [t] = applySplits(
      [{ date: "2019-01-02", ticker: "AAPL", quantity: 10, price: 200 }],
      [AAPL_4FOR1],
    );
    expect(t.quantity).toBe(40);
    expect(t.price).toBe(50);
  });

  it("leaves on/after-split trades untouched (strictly-before boundary)", () => {
    const onDate = applySplits([{ date: "2020-08-31", ticker: "AAPL", quantity: 40, price: 50 }], [AAPL_4FOR1]);
    expect(onDate[0].quantity).toBe(40);
    const after = applySplits([{ date: "2021-01-04", ticker: "AAPL", quantity: 40, price: 50 }], [AAPL_4FOR1]);
    expect(after[0].quantity).toBe(40);
  });

  it("compounds multiple splits before a trade", () => {
    const splits: StockSplit[] = [
      { ticker: "NVDA", date: "2021-07-20", numerator: 4, denominator: 1 },
      { ticker: "NVDA", date: "2024-06-10", numerator: 10, denominator: 1 },
    ];
    const [t] = applySplits([{ date: "2019-01-02", ticker: "NVDA", quantity: 5, price: 4000 }], splits);
    expect(t.quantity).toBe(200); // 5 × 4 × 10
    expect(t.price).toBe(100); // 4000 ÷ 40
  });

  it("does not touch option (OCC) tickers or other symbols", () => {
    const rows = [
      { date: "2019-01-02", ticker: "AAPL240119C00150000", quantity: 1, price: 3.2 },
      { date: "2019-01-02", ticker: "MSFT", quantity: 10, price: 100 },
    ];
    const out = applySplits(rows, [AAPL_4FOR1]);
    expect(out).toEqual(rows);
  });

  it("is a no-op with no splits", () => {
    const rows = [{ date: "2019-01-02", ticker: "AAPL", quantity: 10, price: 200 }];
    expect(applySplits(rows, [])).toBe(rows);
  });
});

// The headline guarantee: a real 2019→2024 AAPL round-trip reconciles correctly
// only once the 4:1 split is applied. This is the bug the whole mechanism exists
// to prevent — importing history without split-adjustment silently corrupts basis.
describe("split-adjusted history through the real tax-lot engine", () => {
  const buy2019: LedgerTxn = {
    id: "buy-2019",
    date: "2019-01-02",
    type: "buy",
    quantity: 10, // pre-split shares
    amount: 2000, // $200 × 10
    price: 200,
    fees: 0,
    ticker: "AAPL",
  };
  const sell2024: LedgerTxn = {
    id: "sell-2024",
    date: "2024-01-02",
    type: "sell",
    quantity: -40, // post-split shares (broker exports these)
    amount: -2400, // $60 × 40
    price: 60,
    fees: 0,
    ticker: "AAPL",
  };

  it("WITHOUT split adjustment: quantities mismatch, sell partially dropped", () => {
    const lots = computeRealizedLots([buy2019, sell2024]);
    const totalQty = lots.reduce((s, l) => s + l.quantity, 0);
    expect(totalQty).toBe(10); // only 10 of the 40 sold shares matched — 30 silently lost
    expect(summarize(lots).proceeds).toBeCloseTo(600, 6); // proceeds understated (10 × $60)
  });

  it("WITH split adjustment: the full 40 shares reconcile with correct basis & gain", () => {
    const adjusted = applySplits([buy2019, sell2024], [AAPL_4FOR1]);
    const lots = computeRealizedLots(adjusted);

    expect(lots).toHaveLength(1);
    const [lot] = lots;
    expect(lot.quantity).toBe(40);
    expect(lot.basis).toBeCloseTo(2000, 6); // $2,000 basis preserved across the split
    expect(lot.proceeds).toBeCloseTo(2400, 6);
    expect(lot.gain).toBeCloseTo(400, 6);
    expect(lot.term).toBe("long"); // held ~5 years

    const summary = summarize(lots);
    expect(summary.longTerm).toBeCloseTo(400, 6);
    expect(summary.proceeds).toBeCloseTo(2400, 6);
  });
});
