import { describe, it, expect } from "vitest";
import {
  computeComparison,
  normalizeToBase100,
  twrIndexSeries,
  windowReturn,
  type FlowPoint,
  type ValuePoint,
} from "@/lib/benchmark";
import type { PricePoint } from "@/lib/yahoo";

/** Percent change from the first to the last point of a base-100 index series. */
const totalReturnPct = (series: ValuePoint[]): number =>
  series.length < 2 ? 0 : (series[series.length - 1].value / series[0].value - 1) * 100;

describe("twrIndexSeries", () => {
  it("reports ~0% when the portfolio only grows via a deposit (no price change)", () => {
    // Fund with 1 share @ $100, then buy a second share @ $100 the next day.
    // Market value doubles (100 → 200) purely from deposited capital — a naive
    // value/value return would read +100%. TWR must back the deposit out and
    // report ~0%, since no price appreciation actually occurred.
    const series: FlowPoint[] = [
      { date: "2025-01-01", value: 100, flow: 100 },
      { date: "2025-01-02", value: 200, flow: 100 },
      { date: "2025-01-03", value: 200, flow: 0 },
    ];
    const idx = twrIndexSeries(series);
    expect(idx.map((p) => p.value)).toEqual([100, 100, 100]);
    expect(totalReturnPct(idx)).toBeCloseTo(0, 6);
  });

  it("measures genuine price appreciation and ignores an interleaved deposit", () => {
    const series: FlowPoint[] = [
      { date: "2025-01-01", value: 100, flow: 0 }, // base
      { date: "2025-01-02", value: 110, flow: 0 }, // +10%
      { date: "2025-01-03", value: 210, flow: 100 }, // bought at the new price → no return
      { date: "2025-01-04", value: 231, flow: 0 }, // +10% again on the larger base
    ];
    const idx = twrIndexSeries(series);
    // Two independent +10% days compound to +21%, deposit contributing nothing.
    expect(totalReturnPct(idx)).toBeCloseTo(21, 6);
  });

  it("re-anchors when the prior day's value is zero (first funding day)", () => {
    const series: FlowPoint[] = [
      { date: "2025-01-01", value: 0, flow: 0 }, // empty
      { date: "2025-01-02", value: 100, flow: 100 }, // first funding — not a return
      { date: "2025-01-03", value: 110, flow: 0 }, // +10%
    ];
    const idx = twrIndexSeries(series);
    expect(idx[0].value).toBe(100);
    expect(idx[1].value).toBe(100); // funding day re-anchors, no return
    expect(idx[2].value).toBeCloseTo(110, 6);
    expect(totalReturnPct(idx)).toBeCloseTo(10, 6);
  });

  it("treats a withdrawal (sell) symmetrically — no phantom loss", () => {
    // Sell half the position with no price move: value halves but that's a
    // withdrawal, not a loss, so TWR stays flat.
    const series: FlowPoint[] = [
      { date: "2025-01-01", value: 200, flow: 0 },
      { date: "2025-01-02", value: 100, flow: -100 },
    ];
    const idx = twrIndexSeries(series);
    expect(totalReturnPct(idx)).toBeCloseTo(0, 6);
  });

  it("returns an empty series for empty input", () => {
    expect(twrIndexSeries([])).toEqual([]);
  });
});

describe("computeComparison on a TWR series", () => {
  it("does not credit a deposit as outperformance vs a flat benchmark", () => {
    // A full year where the only 'growth' is a mid-year deposit doubling the
    // market value. Fed the TWR index (deposit removed), the portfolio should
    // report ~0% — not the +100% a raw value series would have shown.
    const flow: FlowPoint[] = [
      { date: "2024-07-01", value: 100, flow: 0 },
      { date: "2025-01-02", value: 200, flow: 100 }, // deposit, no price change
      { date: "2025-07-01", value: 200, flow: 0 },
    ];
    const twr = twrIndexSeries(flow);

    // A perfectly flat benchmark over the same span.
    const flatBench: PricePoint[] = [
      { date: "2024-07-01", close: 400 },
      { date: "2025-01-02", close: 400 },
      { date: "2025-07-01", close: 400 },
    ];

    const rows = computeComparison(twr, { SPY: flatBench });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // Deposit-adjusted return is ~0, so the portfolio neither beats nor trails
      // the flat benchmark.
      expect(r.portfolioPct ?? 0).toBeCloseTo(0, 6);
      expect(r.deltaVsSpy ?? 0).toBeCloseTo(0, 6);
    }
  });
});

describe("normalizeToBase100 / windowReturn (unchanged helpers)", () => {
  it("rebases the first point to 100", () => {
    const out = normalizeToBase100([
      { date: "a", value: 250 },
      { date: "b", value: 500 },
    ]);
    expect(out[0].value).toBe(100);
    expect(out[1].value).toBe(200);
  });

  it("returns null when the window reaches before the series begins", () => {
    const series: ValuePoint[] = [
      { date: "2025-06-01", value: 100 },
      { date: "2025-06-10", value: 110 },
    ];
    // A 1Y window from a series only ~10 days long can't be honestly reported.
    expect(windowReturn(series, "1Y")).toBeNull();
  });
});
