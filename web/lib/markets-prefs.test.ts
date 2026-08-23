import { describe, it, expect } from "vitest";
import { DEFAULT_PREFS, TIMEFRAMES, coercePrefs, normalizeSymbol } from "./markets-prefs";

/**
 * These two functions are the only guard between the `app_settings` KV blob and
 * the desk: a hand-edited row, a blob written before a field existed, or a
 * typo'd ticker all arrive here. Anything they let through renders.
 */

describe("normalizeSymbol", () => {
  it("uppercases, trims, and strips a leading $", () => {
    expect(normalizeSymbol("  aapl ")).toBe("AAPL");
    expect(normalizeSymbol("$nvda")).toBe("NVDA");
  });

  it("accepts the punctuation real Yahoo symbols use", () => {
    expect(normalizeSymbol("BRK-B")).toBe("BRK-B");
    expect(normalizeSymbol("btc-usd")).toBe("BTC-USD");
    expect(normalizeSymbol("^GSPC")).toBe("^GSPC");
    expect(normalizeSymbol("ES=F")).toBe("ES=F");
    expect(normalizeSymbol("EURUSD=X")).toBe("EURUSD=X");
    expect(normalizeSymbol("BMW.DE")).toBe("BMW.DE");
  });

  it("rejects empties, junk, and anything overlong", () => {
    for (const bad of ["", "   ", "a b", "AA PL", "SELECT *", "hello!", "A".repeat(20)]) {
      expect(normalizeSymbol(bad)).toBeNull();
    }
  });
});

describe("coercePrefs", () => {
  it("returns the defaults for null, junk, and empty input", () => {
    expect(coercePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(coercePrefs({})).toEqual(DEFAULT_PREFS);
    expect(coercePrefs("nope")).toEqual(DEFAULT_PREFS);
  });

  it("keeps valid values through a round trip", () => {
    const prefs = {
      range: "1y" as const,
      interval: "1wk" as const,
      columns: 3 as const,
      hull: { mode: "Thma" as const, length: 180, lengthMult: 2.5, source: "hlc3" as const },
      showBand: false,
      colorCandles: true,
      showVolume: false,
    };
    expect(coercePrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
  });

  it("falls back per-field rather than discarding the whole object", () => {
    const out = coercePrefs({ range: "banana", interval: "1h", columns: 9 });
    expect(out.range).toBe(DEFAULT_PREFS.range);
    expect(out.interval).toBe("1h"); // the one good field survives
    expect(out.columns).toBe(DEFAULT_PREFS.columns);
  });

  it("clamps Hull numerics into a plottable range", () => {
    expect(coercePrefs({ hull: { length: 5000 } }).hull.length).toBe(400);
    expect(coercePrefs({ hull: { length: 0 } }).hull.length).toBe(2);
    expect(coercePrefs({ hull: { length: 55.6 } }).hull.length).toBe(56);
    expect(coercePrefs({ hull: { lengthMult: 99 } }).hull.lengthMult).toBe(10);
    expect(coercePrefs({ hull: { lengthMult: 0 } }).hull.lengthMult).toBe(0.1);
    expect(coercePrefs({ hull: { length: "abc" } }).hull.length).toBe(DEFAULT_PREFS.hull.length);
  });

  it("rejects a non-boolean toggle instead of coercing it", () => {
    expect(coercePrefs({ showBand: "false" }).showBand).toBe(DEFAULT_PREFS.showBand);
    expect(coercePrefs({ showBand: false }).showBand).toBe(false);
  });
});

describe("TIMEFRAMES", () => {
  it("gives every preset enough bars to clear a 55-length Hull warm-up", () => {
    // Roughly: bars = window / bar size. The tightest preset is 5D of 15m bars,
    // ~26 bars a session — the point is that no button lands on a blank chart.
    const barsPer: Record<string, number> = { "5D": 130, "1M": 154, "3M": 63, "6M": 126, "1Y": 252, "2Y": 504, "5Y": 260, Max: 300 };
    for (const t of TIMEFRAMES) expect(barsPer[t.label]).toBeGreaterThan(55);
  });

  it("has unique labels and range/interval pairs", () => {
    expect(new Set(TIMEFRAMES.map((t) => t.label)).size).toBe(TIMEFRAMES.length);
    expect(new Set(TIMEFRAMES.map((t) => `${t.range}|${t.interval}`)).size).toBe(TIMEFRAMES.length);
  });

  it("every preset survives coercePrefs unchanged", () => {
    for (const t of TIMEFRAMES) {
      const out = coercePrefs({ range: t.range, interval: t.interval });
      expect([out.range, out.interval]).toEqual([t.range, t.interval]);
    }
  });
});
