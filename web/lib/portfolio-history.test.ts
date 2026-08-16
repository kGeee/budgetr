import { describe, it, expect } from "vitest";
import { downsampleHistories, downsampleSeries } from "@/lib/portfolio-history";
import type { PricePoint } from "@/lib/yahoo";

const series = (n: number): PricePoint[] =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    close: 100 + i,
  }));

describe("downsampleSeries", () => {
  it("keeps a short series intact", () => {
    const s = series(40);
    expect(downsampleSeries(s, 130)).toHaveLength(40);
  });

  it("thins a long series to the cap", () => {
    expect(downsampleSeries(series(252), 130)).toHaveLength(130);
    expect(downsampleSeries(series(1000), 130)).toHaveLength(130);
  });

  it("never moves the endpoints", () => {
    // The last close is what a holding is valued at, and the first anchors the
    // chart's left edge — dropping either would change a number on screen.
    const s = series(252);
    const out = downsampleSeries(s, 130);
    expect(out[0]).toEqual(s[0]);
    expect(out[out.length - 1]).toEqual(s[s.length - 1]);
  });

  it("keeps the series in order and free of duplicates", () => {
    const out = downsampleSeries(series(252), 130);
    const closes = out.map((p) => p.close);
    expect([...closes].sort((a, b) => a - b)).toEqual(closes);
    expect(new Set(closes).size).toBe(closes.length);
  });

  it("rounds float32 noise away to cents", () => {
    // Yahoo closes arrive as float32 widened to double: 644.8900146484375
    // serializes fourteen characters of noise per point.
    const [p] = downsampleSeries([{ date: "2026-01-01", close: 644.8900146484375 }]);
    expect(p.close).toBe(644.89);
  });

  it("handles degenerate inputs", () => {
    expect(downsampleSeries([], 130)).toEqual([]);
    expect(downsampleSeries(series(1), 130)).toHaveLength(1);
  });

  it("maps every ticker in a history record", () => {
    const out = downsampleHistories({ AAPL: series(252), VTI: series(10) }, 130);
    expect(out.AAPL).toHaveLength(130);
    expect(out.VTI).toHaveLength(10);
  });
});
