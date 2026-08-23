import { describe, it, expect } from "vitest";
import {
  wmaSeries,
  emaSeries,
  hmaSeries,
  ehmaSeries,
  thmaSeries,
  hullSeries,
  hullSuite,
  hullTrend,
  sourceOf,
  DEFAULT_HULL,
  type Bar,
} from "./hull";

/** Synthetic bars from a close series; OHLC is a tight box around each close. */
function barsOf(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    t: Date.UTC(2026, 0, 1) + i * 86_400_000,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }));
}

const ramp = (n: number, from = 100, step = 1) =>
  Array.from({ length: n }, (_, i) => from + i * step);

describe("wmaSeries", () => {
  it("weights the newest bar heaviest", () => {
    // (1*1 + 2*2 + 3*3) / 6 = 2.3333
    expect(wmaSeries([1, 2, 3], 3)[2]).toBeCloseTo(14 / 6, 10);
  });

  it("is null until the window is full", () => {
    const out = wmaSeries([1, 2, 3, 4], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).not.toBeNull();
  });

  it("truncates a fractional period the way Pine's int cast does", () => {
    // 55/2 = 27.5 must behave as a 27-bar window, not 28.
    const v = ramp(40);
    expect(wmaSeries(v, 27.5)).toEqual(wmaSeries(v, 27));
    expect(wmaSeries(v, 27.5)).not.toEqual(wmaSeries(v, 28));
  });

  it("propagates nulls out of the window", () => {
    const out = wmaSeries([1, null, 3, 4, 5], 2);
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull(); // window still contains the null
    expect(out[3]).toBeCloseTo((3 * 1 + 4 * 2) / 3, 10);
  });

  it("tracks a straight line exactly once warmed up", () => {
    // On a linear ramp the WMA sits a fixed distance below the last value.
    const out = wmaSeries(ramp(20), 5);
    expect(out[19]!).toBeCloseTo(119 - 4 / 3, 10);
  });
});

describe("emaSeries", () => {
  it("seeds with the SMA of the first period values", () => {
    const out = emaSeries([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10); // (1+2+3)/3
    expect(out[3]).toBeCloseTo(4 * 0.5 + 2 * 0.5, 10);
  });

  it("skips leading nulls without shifting the output alignment", () => {
    const out = emaSeries([null, null, 1, 2, 3], 3);
    expect(out.length).toBe(5);
    expect(out[3]).toBeNull();
    expect(out[4]).toBeCloseTo(2, 10);
  });

  it("converges to a constant series", () => {
    const out = emaSeries(new Array(50).fill(7), 10);
    expect(out[49]!).toBeCloseTo(7, 10);
  });
});

/**
 * On a linear ramp every one of these MAs settles to `price - lag`, and the lag
 * is exact: a p-bar WMA lags by (p-1)/3, a p-bar EMA by (p-1)/2. Composing the
 * Hull constructions out of those gives a closed form to test against, which is
 * much stronger than "roughly tracks price" — it pins the exact sub-window sizes
 * the Pine int-casts produce.
 *
 * They do NOT land exactly on the line: `round(sqrt(20))` is 4, not 4.472, and
 * `20/2` and `20/3` truncate. That residual lag is the port being faithful, not
 * a bug.
 */
describe("Hull variations", () => {
  it("HMA leads a plain WMA on a ramp, by the exact expected amount", () => {
    const v = ramp(80);
    const hma = hmaSeries(v, 20)[79]!;
    const wma = wmaSeries(v, 20)[79]!;
    expect(hma).toBeGreaterThan(wma);
    // raw = 2·wma(10) - wma(20) → price + 1/3; outer wma(round(√20)=4) lags 1.
    expect(hma).toBeCloseTo(179 - 2 / 3, 9);
  });

  it("EHMA settles to price minus its composed EMA lag", () => {
    // raw = 2·ema(10) - ema(20) → price + 1/2; outer ema(4) lags 3/2.
    expect(ehmaSeries(ramp(200), 20)[199]!).toBeCloseTo(299 - 1, 4);
  });

  it("THMA settles to price minus its composed WMA lag", () => {
    // raw = 3·wma(6) - wma(10) - wma(20) → price + 13/3; outer wma(20) lags 19/3.
    expect(thmaSeries(ramp(200), 20)[199]!).toBeCloseTo(299 - 2, 9);
  });

  it("all three are null while warming up", () => {
    const v = ramp(10);
    expect(hmaSeries(v, 55).every((x) => x === null)).toBe(true);
    expect(ehmaSeries(v, 55).every((x) => x === null)).toBe(true);
    expect(thmaSeries(v, 55).every((x) => x === null)).toBe(true);
  });
});

describe("hullSeries mode switch", () => {
  const v = ramp(300);

  it("Hma calls HMA with the full length", () => {
    expect(hullSeries(v, { ...DEFAULT_HULL, mode: "Hma", length: 55 })).toEqual(
      hmaSeries(v, 55),
    );
  });

  it("Ehma calls EHMA with the full length", () => {
    expect(hullSeries(v, { ...DEFAULT_HULL, mode: "Ehma", length: 55 })).toEqual(
      ehmaSeries(v, 55),
    );
  });

  it("Thma is fed half the length, matching the Pine mode switch", () => {
    expect(hullSeries(v, { ...DEFAULT_HULL, mode: "Thma", length: 55 })).toEqual(
      thmaSeries(v, 27.5),
    );
    // and is therefore NOT the same as THMA at the full length
    expect(hullSeries(v, { ...DEFAULT_HULL, mode: "Thma", length: 55 })).not.toEqual(
      thmaSeries(v, 55),
    );
  });

  it("lengthMult scales the effective length with an int cast", () => {
    // 55 * 1.5 = 82.5 → 82
    expect(hullSeries(v, { ...DEFAULT_HULL, length: 55, lengthMult: 1.5 })).toEqual(
      hmaSeries(v, 82),
    );
  });
});

describe("sourceOf", () => {
  const bar: Bar = { t: 0, open: 10, high: 14, low: 6, close: 12, volume: null };
  it("resolves each Pine source", () => {
    expect(sourceOf(bar, "close")).toBe(12);
    expect(sourceOf(bar, "open")).toBe(10);
    expect(sourceOf(bar, "high")).toBe(14);
    expect(sourceOf(bar, "low")).toBe(6);
    expect(sourceOf(bar, "hl2")).toBe(10);
    expect(sourceOf(bar, "hlc3")).toBeCloseTo(32 / 3, 10);
    expect(sourceOf(bar, "ohlc4")).toBe(10.5);
  });
});

describe("hullSuite", () => {
  const settings = { ...DEFAULT_HULL, length: 20 };

  it("SHULL is MHULL lagged exactly two bars", () => {
    const pts = hullSuite(barsOf(ramp(120)), settings);
    for (let i = 2; i < pts.length; i++) {
      expect(pts[i].shull).toBe(pts[i - 2].mhull);
    }
    expect(pts[0].shull).toBeNull();
    expect(pts[1].shull).toBeNull();
  });

  it("is up through a rising market and down through a falling one", () => {
    const up = hullSuite(barsOf(ramp(120)), settings);
    expect(up[119].up).toBe(true);
    const down = hullSuite(barsOf(ramp(120, 300, -1)), settings);
    expect(down[119].up).toBe(false);
  });

  it("returns one point per bar, with a null head while warming up", () => {
    const pts = hullSuite(barsOf(ramp(120)), settings);
    expect(pts.length).toBe(120);
    expect(pts[0]).toEqual({ mhull: null, shull: null, up: null });
  });

  it("handles an empty and a very short series without throwing", () => {
    expect(hullSuite([], settings)).toEqual([]);
    expect(hullSuite(barsOf([1, 2, 3]), settings).every((p) => p.up === null)).toBe(true);
  });
});

describe("hullTrend", () => {
  const settings = { ...DEFAULT_HULL, length: 20 };

  it("reports the direction and how long it has held", () => {
    const bars = barsOf(ramp(140));
    const t = hullTrend(bars, hullSuite(bars, settings));
    expect(t.direction).toBe("up");
    expect(t.barsSince).toBeGreaterThan(0);
    expect(t.changeSinceFlip!).toBeGreaterThan(0);
  });

  it("catches a flip: a long rise then a sharp fall reads down and recent", () => {
    // 120 bars up, then 25 bars sharply down — the Hull should have rolled over
    // recently, so barsSince is small relative to the whole window.
    const closes = [...ramp(120), ...ramp(25, 219, -6)];
    const bars = barsOf(closes);
    const t = hullTrend(bars, hullSuite(bars, settings));
    expect(t.direction).toBe("down");
    expect(t.barsSince!).toBeLessThan(25);
    expect(t.changeSinceFlip!).toBeLessThan(0);
    expect(t.flippedAt).toBe(bars[bars.length - 1 - t.barsSince!].t);
  });

  it("is all-null when nothing can be plotted", () => {
    const bars = barsOf(ramp(5));
    expect(hullTrend(bars, hullSuite(bars, settings))).toEqual({
      direction: null,
      barsSince: null,
      flippedAt: null,
      flipPrice: null,
      changeSinceFlip: null,
    });
  });
});
