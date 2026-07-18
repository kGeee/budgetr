import { describe, it, expect } from "vitest";
import { newSplits, isEquityTicker } from "@/lib/import/split-detect";
import type { StockSplit } from "@/lib/import/splits";

describe("isEquityTicker", () => {
  it("accepts plain equity tickers and rejects OCC option symbols", () => {
    expect(isEquityTicker("AAPL")).toBe(true);
    expect(isEquityTicker("BRK.B")).toBe(true);
    expect(isEquityTicker("AAPL240119C00150000")).toBe(false);
    expect(isEquityTicker("")).toBe(false);
  });
});

describe("newSplits", () => {
  const fetched = [
    { date: "2020-08-31", numerator: 4, denominator: 1 },
    { date: "2014-06-09", numerator: 7, denominator: 1 },
  ];

  it("suggests every fetched split when none are recorded", () => {
    expect(newSplits("AAPL", fetched, [])).toHaveLength(2);
    expect(newSplits("aapl", fetched, [])[0].ticker).toBe("AAPL");
  });

  it("omits splits already recorded (by ticker + date)", () => {
    const existing: StockSplit[] = [{ ticker: "AAPL", date: "2020-08-31", numerator: 4, denominator: 1 }];
    const out = newSplits("AAPL", fetched, existing);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2014-06-09");
  });

  it("does not treat another ticker's split on the same date as recorded", () => {
    const existing: StockSplit[] = [{ ticker: "TSLA", date: "2020-08-31", numerator: 5, denominator: 1 }];
    expect(newSplits("AAPL", fetched, existing)).toHaveLength(2);
  });
});
