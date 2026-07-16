import { describe, it, expect } from "vitest";
import {
  classifyExpiry,
  listExpiries,
  volatilitySmile,
  atmIv,
  skew25,
  flowByStrike,
  putCallStats,
  maxPain,
  gammaExposureByStrike,
  totalGex,
  greekByStrike,
  buildIvSurface,
} from "@/lib/option-chain-analytics";
import type { OptionQuote } from "@/lib/yahoo";

// Fixed "now" so every DTE/classification is deterministic.
const NOW = new Date("2026-01-15T12:00:00Z");

/** Terse OptionQuote builder — fills nulls / synthesizes occ+expiry for anything omitted. */
function q(o: Partial<OptionQuote> & { strike: number; right: "call" | "put" }): OptionQuote {
  const expiry = o.expiry ?? "2026-02-20";
  return {
    occ: o.occ ?? `AAA-${expiry}-${o.right}-${o.strike}`,
    expiry,
    strike: o.strike,
    right: o.right,
    bid: o.bid ?? null,
    ask: o.ask ?? null,
    last: o.last ?? null,
    iv: o.iv ?? null,
    openInterest: o.openInterest ?? null,
    volume: o.volume ?? null,
    inTheMoney: o.inTheMoney ?? null,
    greeks: o.greeks ?? null,
  };
}

describe("classifyExpiry", () => {
  it("flags a non-quarter third Friday as monthly", () => {
    expect(classifyExpiry("2026-01-16")).toBe("monthly"); // 3rd Fri of Jan
    expect(classifyExpiry("2026-02-20")).toBe("monthly"); // 3rd Fri of Feb
  });
  it("flags a quarter-end month third Friday as quarterly", () => {
    expect(classifyExpiry("2026-03-20")).toBe("quarterly"); // 3rd Fri of Mar
  });
  it("flags a weekly Friday and a mid-week date as weekly", () => {
    expect(classifyExpiry("2026-01-09")).toBe("weekly"); // Fri but not 3rd
    expect(classifyExpiry("2026-01-14")).toBe("weekly"); // Wednesday
  });
});

describe("listExpiries", () => {
  it("returns distinct expiries ascending by dte, with counts and kind", () => {
    const chain = [
      q({ strike: 100, right: "call", expiry: "2026-03-20" }),
      q({ strike: 100, right: "put", expiry: "2026-03-20" }),
      q({ strike: 100, right: "call", expiry: "2026-01-16" }),
      q({ strike: 105, right: "call", expiry: "2026-01-16" }),
      q({ strike: 100, right: "call", expiry: "2026-02-20" }),
    ];
    const out = listExpiries(chain, NOW);
    expect(out.map((e) => e.expiry)).toEqual(["2026-01-16", "2026-02-20", "2026-03-20"]);
    expect(out.map((e) => e.contracts)).toEqual([2, 1, 2]);
    expect(out.map((e) => e.kind)).toEqual(["monthly", "monthly", "quarterly"]);
    expect(out.map((e) => e.dte)).toEqual([1, 36, 64]);
  });
});

describe("volatilitySmile", () => {
  it("maps call/put IV per strike, ascending, and drops IV-less strikes", () => {
    const chain = [
      q({ strike: 110, right: "call", iv: 0.22 }),
      q({ strike: 90, right: "put", iv: 0.35 }),
      q({ strike: 100, right: "call", iv: 0.28 }),
      q({ strike: 100, right: "put", iv: 0.3 }),
      q({ strike: 120, right: "call", iv: null }), // no IV → dropped
      q({ strike: 95, right: "call", iv: 0 }), // non-positive → dropped
    ];
    const smile = volatilitySmile(chain, "2026-02-20");
    expect(smile.map((p) => p.strike)).toEqual([90, 100, 110]);
    expect(smile[0]).toMatchObject({ strike: 90, callIv: null, putIv: 0.35 });
    expect(smile[1]).toMatchObject({ strike: 100, callIv: 0.28, putIv: 0.3 });
    expect(smile[2]).toMatchObject({ strike: 110, callIv: 0.22, putIv: null });
  });
  it("annotates log-moneyness only when spot is given", () => {
    const chain = [q({ strike: 110, right: "call", iv: 0.2 })];
    expect(volatilitySmile(chain, "2026-02-20", 100)[0].moneyness).toBeCloseTo(Math.log(1.1), 9);
    expect(volatilitySmile(chain, "2026-02-20")[0].moneyness).toBeNull();
  });
});

describe("atmIv", () => {
  it("takes the nearest-strike IV, averaging call+put when both present", () => {
    const chain = [
      q({ strike: 95, right: "call", iv: 0.4 }),
      q({ strike: 100, right: "call", iv: 0.3 }),
      q({ strike: 100, right: "put", iv: 0.34 }),
      q({ strike: 110, right: "call", iv: 0.25 }),
    ];
    expect(atmIv(chain, "2026-02-20", 101)).toBeCloseTo(0.32, 9); // (0.3+0.34)/2 at K=100
  });
  it("is null without spot or without priced strikes", () => {
    const chain = [q({ strike: 100, right: "call", iv: 0.3 })];
    expect(atmIv(chain, "2026-02-20", null)).toBeNull();
    expect(atmIv([q({ strike: 100, right: "call", iv: null })], "2026-02-20", 100)).toBeNull();
  });
});

describe("skew25", () => {
  it("is positive when OTM puts are bid over OTM calls", () => {
    const chain = [
      q({ strike: 90, right: "put", iv: 0.4 }),
      q({ strike: 110, right: "call", iv: 0.25 }),
    ];
    expect(skew25(chain, "2026-02-20", 100)).toBeCloseTo(0.15, 9); // 0.40 − 0.25
  });
  it("is null when a wing is missing or no spot", () => {
    const onlyPut = [q({ strike: 90, right: "put", iv: 0.4 })];
    expect(skew25(onlyPut, "2026-02-20", 100)).toBeNull();
    const both = [
      q({ strike: 90, right: "put", iv: 0.4 }),
      q({ strike: 110, right: "call", iv: 0.25 }),
    ];
    expect(skew25(both, "2026-02-20", null)).toBeNull();
  });
});

describe("flowByStrike", () => {
  it("sums OI + volume per strike per side, ascending", () => {
    const chain = [
      q({ strike: 100, right: "call", openInterest: 100, volume: 10 }),
      q({ strike: 100, right: "put", openInterest: 200, volume: 20 }),
      q({ strike: 90, right: "call", openInterest: 5, volume: 1 }),
    ];
    const out = flowByStrike(chain, "2026-02-20");
    expect(out.map((r) => r.strike)).toEqual([90, 100]);
    expect(out[1]).toEqual({ strike: 100, callOi: 100, putOi: 200, callVol: 10, putVol: 20 });
    expect(out[0]).toMatchObject({ callOi: 5, putOi: 0, callVol: 1, putVol: 0 });
  });
});

describe("putCallStats", () => {
  it("sums both sides and computes ratios", () => {
    const chain = [
      q({ strike: 100, right: "call", openInterest: 100, volume: 40 }),
      q({ strike: 100, right: "put", openInterest: 150, volume: 60 }),
    ];
    const s = putCallStats(chain);
    expect(s).toMatchObject({ callOi: 100, putOi: 150, callVol: 40, putVol: 60 });
    expect(s.oiRatio).toBeCloseTo(1.5, 9);
    expect(s.volRatio).toBeCloseTo(1.5, 9);
  });
  it("nulls ratios when the call denominator is zero", () => {
    const chain = [q({ strike: 100, right: "put", openInterest: 150, volume: 60 })];
    const s = putCallStats(chain);
    expect(s.oiRatio).toBeNull();
    expect(s.volRatio).toBeNull();
  });
});

describe("maxPain", () => {
  it("picks the strike minimizing total intrinsic value", () => {
    // Symmetric OI across 90/100/110 → pain minimized at the middle strike.
    const chain = [
      q({ strike: 90, right: "call", openInterest: 10 }),
      q({ strike: 90, right: "put", openInterest: 10 }),
      q({ strike: 100, right: "call", openInterest: 10 }),
      q({ strike: 100, right: "put", openInterest: 10 }),
      q({ strike: 110, right: "call", openInterest: 10 }),
      q({ strike: 110, right: "put", openInterest: 10 }),
    ];
    expect(maxPain(chain, "2026-02-20")).toBe(100);
  });
  it("is null when there is no open interest", () => {
    const chain = [q({ strike: 100, right: "call" }), q({ strike: 100, right: "put" })];
    expect(maxPain(chain, "2026-02-20")).toBeNull();
  });
});

describe("gammaExposureByStrike / totalGex", () => {
  it("signs call gamma positive and put gamma negative via spot²·0.01·γ·OI·100", () => {
    const chain = [
      q({ strike: 100, right: "call", openInterest: 10, greeks: g({ gamma: 0.05 }) }),
      q({ strike: 90, right: "put", openInterest: 20, greeks: g({ gamma: 0.04 }) }),
    ];
    const pts = gammaExposureByStrike(chain, "2026-02-20", 100);
    // factor = 100^2 * 0.01 * 100 = 10000
    expect(pts.map((p) => p.strike)).toEqual([90, 100]);
    expect(pts.find((p) => p.strike === 100)!.gex).toBeCloseTo(5000, 6); // +0.05*10*10000
    expect(pts.find((p) => p.strike === 90)!.gex).toBeCloseTo(-8000, 6); // -0.04*20*10000
    expect(totalGex(chain, "2026-02-20", 100)).toBeCloseTo(-3000, 6);
  });
  it("is empty / null without spot or greeks", () => {
    const noGreeks = [q({ strike: 100, right: "call", openInterest: 10 })];
    expect(gammaExposureByStrike(noGreeks, "2026-02-20", 100)).toEqual([]);
    expect(totalGex(noGreeks, "2026-02-20", 100)).toBeNull();
    const withGreeks = [
      q({ strike: 100, right: "call", openInterest: 10, greeks: g({ gamma: 0.05 }) }),
    ];
    expect(gammaExposureByStrike(withGreeks, "2026-02-20", null)).toEqual([]);
    expect(totalGex(withGreeks, "2026-02-20", null)).toBeNull();
  });
});

describe("greekByStrike", () => {
  it("picks the chosen greek per side per strike, ascending", () => {
    const chain = [
      q({ strike: 100, right: "call", greeks: g({ delta: 0.55 }) }),
      q({ strike: 100, right: "put", greeks: g({ delta: -0.45 }) }),
      q({ strike: 90, right: "call", greeks: g({ delta: 0.7 }) }),
      q({ strike: 110, right: "call", greeks: g({ delta: null }) }), // no delta → dropped
    ];
    const out = greekByStrike(chain, "2026-02-20", "delta");
    expect(out.map((p) => p.strike)).toEqual([90, 100]);
    expect(out[1]).toEqual({ strike: 100, call: 0.55, put: -0.45 });
    expect(out[0]).toMatchObject({ strike: 90, call: 0.7, put: null });
  });
});

describe("buildIvSurface", () => {
  it("aligns z[i][j] over strike-rows × expiry-cols, mid-averaging both sides", () => {
    const chain = [
      // near expiry
      q({ strike: 100, right: "call", expiry: "2026-01-16", iv: 0.3 }),
      q({ strike: 100, right: "put", expiry: "2026-01-16", iv: 0.34 }),
      q({ strike: 110, right: "call", expiry: "2026-01-16", iv: 0.2 }),
      // far expiry
      q({ strike: 100, right: "call", expiry: "2026-03-20", iv: 0.4 }),
      q({ strike: 90, right: "put", expiry: "2026-03-20", iv: 0.5 }),
    ];
    const surf = buildIvSurface(chain, 100, { now: NOW });
    expect(surf.expiries.map((e) => e.expiry)).toEqual(["2026-01-16", "2026-03-20"]);
    expect(surf.expiries.map((e) => e.dte)).toEqual([1, 64]);
    expect(surf.strikes).toEqual([90, 100, 110]);
    // rows = strikes [90,100,110], cols = expiries [near, far]
    expect(surf.z).toEqual([
      [null, 0.5], // 90: only far put
      [0.32, 0.4], // 100: near mid (0.3+0.34)/2, far call-only
      [0.2, null], // 110: only near call
    ]);
    expect(surf.spot).toBe(100);
  });
  it("respects the chosen side (call)", () => {
    const chain = [
      q({ strike: 100, right: "call", expiry: "2026-01-16", iv: 0.3 }),
      q({ strike: 100, right: "put", expiry: "2026-01-16", iv: 0.34 }),
    ];
    const surf = buildIvSurface(chain, 100, { side: "call", now: NOW });
    expect(surf.z).toEqual([[0.3]]);
  });
  it("drops past expiries (dte < 0)", () => {
    const chain = [
      q({ strike: 100, right: "call", expiry: "2026-01-10", iv: 0.3 }), // dte -5
      q({ strike: 100, right: "call", expiry: "2026-03-20", iv: 0.4 }),
    ];
    const surf = buildIvSurface(chain, 100, { now: NOW });
    expect(surf.expiries.map((e) => e.expiry)).toEqual(["2026-03-20"]);
  });
  it("limits strikes to a window around spot", () => {
    // 7 strikes 97..103, window 1 → keep the nearest strike ±1 → [99,100,101].
    const chain = [97, 98, 99, 100, 101, 102, 103].map((k) =>
      q({ strike: k, right: "call", expiry: "2026-01-16", iv: 0.3 }),
    );
    const surf = buildIvSurface(chain, 100, { strikeWindow: 1, now: NOW });
    expect(surf.strikes).toEqual([99, 100, 101]);
  });
});

/** Terse greeks builder — nulls for anything omitted. */
function g(o: Partial<NonNullable<OptionQuote["greeks"]>>): NonNullable<OptionQuote["greeks"]> {
  return {
    delta: o.delta ?? null,
    gamma: o.gamma ?? null,
    theta: o.theta ?? null,
    vega: o.vega ?? null,
    rho: o.rho ?? null,
  };
}
