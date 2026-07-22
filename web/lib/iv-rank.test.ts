import { describe, it, expect } from "vitest";
import { dailyAtmIv, ivRankFromSeries, type IvSeriesPoint } from "./iv-rank";
import type { IvSnapshotRow } from "./fixed-strike-vol-math";

function row(date: string, expiry: string, strike: number, iv: number, underlying = 100): IvSnapshotRow {
  return { date, expiry, strike, right: "put", iv, underlying };
}

describe("dailyAtmIv", () => {
  it("picks the ~30-DTE expiry and the ATM strike per day", () => {
    const rows: IvSnapshotRow[] = [
      // 2026-01-01: two expiries — one ~5 DTE (out of band), one ~35 DTE (chosen)
      row("2026-01-01", "2026-01-06", 100, 0.9), // 5 DTE — excluded
      row("2026-01-01", "2026-02-05", 95, 0.5),
      row("2026-01-01", "2026-02-05", 100, 0.42), // ATM (spot 100) → chosen
      row("2026-01-01", "2026-02-05", 110, 0.6),
    ];
    const series = dailyAtmIv(rows);
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({ date: "2026-01-01", iv: 0.42 });
  });

  it("averages call/put IV at the ATM strike and sorts by date", () => {
    const rows: IvSnapshotRow[] = [
      { date: "2026-01-02", expiry: "2026-02-05", strike: 100, right: "put", iv: 0.4, underlying: 100 },
      { date: "2026-01-02", expiry: "2026-02-05", strike: 100, right: "call", iv: 0.44, underlying: 100 },
      { date: "2026-01-01", expiry: "2026-02-05", strike: 100, right: "put", iv: 0.3, underlying: 100 },
    ];
    const series = dailyAtmIv(rows);
    expect(series.map((p) => p.date)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(series[1].iv).toBeCloseTo(0.42, 5); // (0.40 + 0.44)/2
  });
});

describe("ivRankFromSeries", () => {
  it("returns null below the minimum history", () => {
    const short: IvSeriesPoint[] = Array.from({ length: 5 }, (_, i) => ({ date: `d${i}`, iv: 0.3 }));
    expect(ivRankFromSeries(short)).toBeNull();
  });

  it("ranks the latest reading between the window low and high", () => {
    // 12 days: min 0.2, max 0.6, latest 0.5 → rank = (0.5−0.2)/(0.6−0.2) = 75
    const ivs = [0.2, 0.3, 0.25, 0.6, 0.4, 0.35, 0.3, 0.45, 0.55, 0.3, 0.4, 0.5];
    const series = ivs.map((iv, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, iv }));
    const r = ivRankFromSeries(series)!;
    expect(r.ivRank).toBeCloseTo(75, 5);
    expect(r.low).toBeCloseTo(0.2, 5);
    expect(r.high).toBeCloseTo(0.6, 5);
    expect(r.current).toBeCloseTo(0.5, 5);
    expect(r.ivPercentile).toBeGreaterThan(0);
    expect(r.ivPercentile).toBeLessThanOrEqual(100);
  });

  it("returns null when the range is degenerate", () => {
    const flat = Array.from({ length: 15 }, (_, i) => ({ date: `d${i}`, iv: 0.4 }));
    expect(ivRankFromSeries(flat)).toBeNull();
  });
});
