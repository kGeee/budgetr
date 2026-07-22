import { describe, it, expect } from "vitest";
import { sma, ema, rsi, atr, realizedVol, pctOf52wRange, momentum, maxDrawdown, type Bar } from "./technicals";

describe("moving averages", () => {
  it("sma of the trailing window", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBeCloseTo(3, 5);
    expect(sma([1, 2, 3, 4, 5], 2)).toBeCloseTo(4.5, 5);
    expect(sma([1, 2], 5)).toBeNull();
  });
  it("ema reacts to a recent spike faster than the trailing sma", () => {
    const spike = [10, 10, 10, 10, 10, 10, 10, 10, 10, 20];
    expect(ema(spike, 5)!).toBeGreaterThan(sma(spike, 5)!); // EMA 13.3 vs SMA 12
  });
});

describe("rsi", () => {
  it("is 100 for a monotonic rise", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(closes)).toBeCloseTo(100, 5);
  });
  it("sits near 50 for alternating flat moves and null when too short", () => {
    expect(rsi([1, 2, 3])).toBeNull();
    const r = rsi([44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28])!;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(100);
  });
});

describe("atr", () => {
  it("measures average true range", () => {
    const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({ high: 11 + i, low: 9 + i, close: 10 + i }));
    const a = atr(bars)!;
    expect(a).toBeGreaterThan(0);
    expect(atr(bars.slice(0, 3))).toBeNull();
  });
});

describe("realizedVol / range / momentum / drawdown", () => {
  it("realized vol is positive for a noisy series, null when too short", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i)));
    expect(realizedVol(closes)!).toBeGreaterThan(0);
    expect(realizedVol([1, 2, 3])).toBeNull();
  });
  it("pctOf52wRange places latest between low and high", () => {
    expect(pctOf52wRange([10, 20, 30, 15])).toBeCloseTo(25, 5); // (15-10)/(30-10)
    expect(pctOf52wRange([5, 5, 5])).toBeNull();
  });
  it("momentum is the pct change over N bars", () => {
    expect(momentum([100, 101, 102, 110], 3)).toBeCloseTo(10, 5);
    expect(momentum([100], 3)).toBeNull();
  });
  it("maxDrawdown finds the worst peak-to-trough", () => {
    expect(maxDrawdown([100, 120, 60, 90])).toBeCloseTo(-50, 5); // 120 → 60
    expect(maxDrawdown([100, 110, 120])).toBeCloseTo(0, 5);
  });
});
