import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  bsPrice,
  generateStrategies,
  midQuote,
  pnlDistribution,
  type GenerateInput,
} from "@/lib/strategy";
import { RISK_FREE_RATE } from "@/lib/greeks";
import { analyzePayoff, type PayoffLeg } from "@/lib/payoff";
import { parseOccSymbol } from "@/lib/options";
import type { OptionQuote } from "@/lib/yahoo";

// Freeze "now" so days-to-expiry is deterministic (~60 days to the test expiry).
const EXPIRY = "2030-03-15";
const T = 60 / 365;
const SIGMA = 0.4;
const SPOT = 100;

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-14T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());

function quote(strike: number, right: "call" | "put"): OptionQuote {
  const price = bsPrice(right, SPOT, strike, SIGMA, T);
  return {
    occ: `TEST${right}${strike}`,
    expiry: EXPIRY,
    strike,
    right,
    bid: Math.max(0.01, price - 0.05),
    ask: price + 0.05,
    last: price,
    iv: SIGMA,
    openInterest: 100,
    volume: 10,
    inTheMoney: right === "call" ? SPOT > strike : SPOT < strike,
    greeks: null,
  };
}

const CHAIN: OptionQuote[] = [];
for (let k = 60; k <= 140; k += 5) {
  CHAIN.push(quote(k, "call"), quote(k, "put"));
}

const baseInput = (over: Partial<GenerateInput> = {}): GenerateInput => ({
  underlying: "TEST",
  expiry: EXPIRY,
  expiryContracts: CHAIN,
  spot: SPOT,
  sigma: SIGMA,
  target: 115,
  bias: "bullish",
  risk: { budget: 100_000, maxLoss: 100_000, definedOnly: true },
  ...over,
});

describe("bsPrice", () => {
  it("respects put-call parity: C − P = S − K·e^(−rT)", () => {
    const c = bsPrice("call", SPOT, 100, SIGMA, T);
    const p = bsPrice("put", SPOT, 100, SIGMA, T);
    expect(c - p).toBeCloseTo(SPOT - 100 * Math.exp(-RISK_FREE_RATE * T), 4);
  });
});

describe("midQuote", () => {
  it("prefers the bid/ask midpoint", () => {
    const q: OptionQuote = { ...quote(100, "call"), bid: 4, ask: 6, last: 99, iv: null };
    expect(midQuote(q, SPOT, T)).toBe(5);
  });
  it("falls back to a Black-Scholes price when unquoted", () => {
    const q: OptionQuote = { ...quote(100, "call"), bid: null, ask: null, last: null };
    expect(midQuote(q, SPOT, T)).toBeCloseTo(bsPrice("call", SPOT, 100, SIGMA, T), 6);
  });
});

describe("pnlDistribution", () => {
  const long: PayoffLeg[] = [{ parsed: parseOccSymbol("TEST300315C00100000")!, quantity: 100, costBasis: 650 }];

  it("integrates to ~1 of probability mass and bounds pWin", () => {
    const d = pnlDistribution(long, SPOT, SIGMA, T)!;
    const mass = d.bins.reduce((s, b) => s + b.prob, 0);
    expect(mass).toBeGreaterThan(0.98);
    expect(d.pWin).toBeGreaterThan(0);
    expect(d.pWin).toBeLessThan(1);
  });

  it("shifts expected value up when centered on a higher target", () => {
    const atSpot = pnlDistribution(long, SPOT, SIGMA, T)!.ev;
    const atTarget = pnlDistribution(long, 130, SIGMA, T)!.ev;
    expect(atTarget).toBeGreaterThan(atSpot);
  });
});

describe("generateStrategies", () => {
  it("proposes bullish structures ranked by fit", () => {
    const cands = generateStrategies(baseInput());
    expect(cands.length).toBeGreaterThan(0);
    const keys = cands.map((c) => c.key);
    expect(keys).toContain("long-call");
    expect(keys).toContain("bull-call-spread");
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].fit).toBeGreaterThanOrEqual(cands[i].fit);
    }
    expect(cands.every((c) => c.fit >= 0 && c.fit <= 1)).toBe(true);
  });

  it("prices a bull call spread with capped, defined risk", () => {
    const spread = generateStrategies(baseInput()).find((c) => c.key === "bull-call-spread")!;
    expect(spread.definedRisk).toBe(true);
    expect(spread.analysis.maxProfitUnbounded).toBe(false);
    expect(spread.analysis.maxLoss).not.toBeNull();
    // A debit spread's capital at risk is its net debit.
    expect(spread.capital).toBeCloseTo(spread.netDebit, 2);
  });

  it("omits undefined-risk structures when definedOnly is set", () => {
    const defined = generateStrategies(baseInput({ bias: "neutral", target: SPOT }));
    expect(defined.map((c) => c.key)).not.toContain("short-strangle");
    const loose = generateStrategies(
      baseInput({ bias: "neutral", target: SPOT, risk: { budget: 1e6, maxLoss: 1e6, definedOnly: false } }),
    );
    expect(loose.map((c) => c.key)).toContain("short-strangle");
  });

  it("flags candidates that exceed the risk budget", () => {
    const tight = generateStrategies(baseInput({ risk: { budget: 50, maxLoss: 50, definedOnly: true } }));
    const lc = tight.find((c) => c.key === "long-call")!;
    expect(lc.withinBudget).toBe(false);
  });

  it("returns [] for an unmodelable expiry (no vol)", () => {
    expect(generateStrategies(baseInput({ sigma: 0 }))).toEqual([]);
  });

  it("still models a same-day (0-DTE) expiry", () => {
    const zeroExpiry = "2030-01-14"; // == frozen "today"
    const chain: OptionQuote[] = [];
    for (let k = 90; k <= 110; k += 5) {
      for (const right of ["call", "put"] as const) {
        const price = bsPrice(right, SPOT, k, SIGMA, 0.5 / 365);
        chain.push({
          occ: `Z${right}${k}`,
          expiry: zeroExpiry,
          strike: k,
          right,
          bid: Math.max(0.01, price - 0.05),
          ask: price + 0.05,
          last: price,
          iv: SIGMA,
          openInterest: 100,
          volume: 10,
          inTheMoney: null,
          greeks: null,
        });
      }
    }
    const cands = generateStrategies(
      baseInput({ expiry: zeroExpiry, expiryContracts: chain, target: 105 }),
    );
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => c.pop == null || (c.pop >= 0 && c.pop <= 1))).toBe(true);
  });
});

describe("cash-secured put capital", () => {
  it("reserves the strike's cash, not just the max loss", () => {
    const csp = generateStrategies(baseInput()).find((c) => c.key === "cash-secured-put")!;
    const strike = csp.legs[0].strike;
    expect(csp.capital).toBeCloseTo(strike * 100, 6);
    // sanity: the payoff engine agrees it's a bounded (defined) loss
    expect(analyzePayoff(csp.payoffLegs).maxLossUnbounded).toBe(false);
  });
});
