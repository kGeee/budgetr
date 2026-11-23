import { describe, expect, it } from "vitest";
import { offPlaidValue, withOffPlaid, type OffPlaid } from "./net-worth";

const off: OffPlaid = {
  fixed: 1_000, // e.g. an iBond
  positions: [
    { symbol: "BTC-USD", quantity: 0.5, fallback: null },
    { symbol: "JUP-USD", quantity: 100, fallback: 40 }, // no quote → stored value
  ],
};

describe("offPlaidValue", () => {
  it("adds fixed assets, priced positions, and the fallback for unquoted ones", () => {
    expect(offPlaidValue(off, { "BTC-USD": 60_000 })).toBe(1_000 + 30_000 + 40);
  });
});

describe("withOffPlaid", () => {
  it("values priced positions at each date's close, carrying the last one forward", () => {
    const series = [
      { date: "2026-11-01", netWorth: 100 },
      { date: "2026-11-02", netWorth: 100 },
      { date: "2026-11-04", netWorth: 100 },
    ];
    const histories = {
      "BTC-USD": [
        { date: "2026-11-01", close: 50_000 },
        { date: "2026-11-03", close: 70_000 },
      ],
    };
    expect(withOffPlaid(series, off, histories, { "BTC-USD": 70_000 }).map((p) => p.netWorth)).toEqual([
      100 + 1_000 + 25_000 + 40,
      100 + 1_000 + 25_000 + 40, // 11-02: still the 11-01 close
      100 + 1_000 + 35_000 + 40, // 11-04: the 11-03 close
    ]);
  });

  it("uses today's price when a symbol has no history", () => {
    const out = withOffPlaid([{ date: "2026-11-01", netWorth: 0 }], off, {}, { "BTC-USD": 60_000 });
    expect(out[0].netWorth).toBe(1_000 + 30_000 + 40);
  });
});
