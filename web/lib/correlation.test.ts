import { describe, it, expect } from "vitest";
import { alignedReturns, pearson, beta, betaTo, portfolioBeta, type CloseSeries } from "./correlation";

const series = (closes: number[], start = 1): CloseSeries =>
  closes.map((close, i) => ({ date: `2026-01-${String(start + i).padStart(2, "0")}`, close }));

describe("alignedReturns", () => {
  it("aligns on common dates and returns daily simple returns", () => {
    const a: CloseSeries = [
      { date: "2026-01-01", close: 100 },
      { date: "2026-01-02", close: 110 },
      { date: "2026-01-03", close: 121 },
    ];
    const b: CloseSeries = [
      { date: "2026-01-02", close: 200 },
      { date: "2026-01-03", close: 220 },
    ];
    const { ra, rb } = alignedReturns(a, b);
    expect(ra).toHaveLength(1); // only 01-02 & 01-03 are common → one return
    expect(ra[0]).toBeCloseTo(0.1, 5);
    expect(rb[0]).toBeCloseTo(0.1, 5);
  });
});

describe("pearson / beta", () => {
  it("is +1 for perfectly correlated returns", () => {
    const x = [0.01, -0.02, 0.03, 0.005, -0.01];
    const y = x.map((v) => v * 2);
    expect(pearson(x, y)).toBeCloseTo(1, 6);
    expect(beta(y, x)).toBeCloseTo(2, 6); // y moves 2× x
  });
  it("returns null with too few points or zero variance", () => {
    expect(pearson([0.01], [0.02])).toBeNull();
    expect(beta([0.01, 0.01, 0.01], [0, 0, 0])).toBeNull();
  });
});

describe("betaTo / portfolioBeta", () => {
  it("computes beta from close series and value-weights the portfolio", () => {
    const bench = series([100, 101, 102, 101, 103, 104]);
    const asset = series([50, 51, 52, 51, 53, 54]);
    const b = betaTo(asset, bench);
    expect(b).not.toBeNull();
    const pb = portfolioBeta([
      { value: 6000, beta: 1.5 },
      { value: 4000, beta: 0.5 },
      { value: 1000, beta: null }, // ignored
    ]);
    expect(pb).toBeCloseTo(1.1, 5); // (6000*1.5 + 4000*0.5)/10000
  });
});
