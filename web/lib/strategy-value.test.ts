import { describe, it, expect } from "vitest";
import { bsPrice, RISK_FREE_RATE } from "./greeks";
import { positionPnl, pnlMatrix, type SigmaFor } from "./strategy-value";
import { payoffAtExpiry, type PayoffLeg } from "./payoff";

function leg(right: "call" | "put", strike: number, contracts: number, mid: number): PayoffLeg {
  const shares = contracts * 100;
  return {
    parsed: { occ: "X", underlying: "X", expiry: "2030-01-01", right, strike },
    quantity: shares,
    costBasis: mid * shares,
  };
}

// Bull call spread: long 100C @ $5, short 110C @ $2 → net debit $3 (=$300).
const SPREAD: PayoffLeg[] = [leg("call", 100, 1, 5), leg("call", 110, -1, 2)];
const sigma: SigmaFor = () => 0.3;

describe("bsPrice", () => {
  it("satisfies put-call parity: C − P = S − K·e^(−rT)", () => {
    const S = 100, K = 105, T = 0.5, v = 0.25;
    const c = bsPrice("call", S, K, T, v);
    const p = bsPrice("put", S, K, T, v);
    expect(c - p).toBeCloseTo(S - K * Math.exp(-RISK_FREE_RATE * T), 6);
  });

  it("collapses to intrinsic at expiry (T=0)", () => {
    expect(bsPrice("call", 120, 100, 0, 0.3)).toBe(20);
    expect(bsPrice("put", 90, 100, 0, 0.3)).toBe(10);
    expect(bsPrice("call", 90, 100, 0, 0.3)).toBe(0);
  });

  it("is worth more before expiry than at it (time value ≥ 0)", () => {
    expect(bsPrice("call", 100, 100, 0.5, 0.3)).toBeGreaterThan(bsPrice("call", 100, 100, 0, 0.3));
  });
});

describe("positionPnl", () => {
  it("equals the exact expiry payoff at T=0, for every price", () => {
    for (const S of [80, 95, 100, 105, 110, 130]) {
      expect(positionPnl(SPREAD, S, 0, sigma)).toBeCloseTo(payoffAtExpiry(SPREAD, S), 6);
    }
  });

  it("caps at max profit and max loss at expiry", () => {
    expect(positionPnl(SPREAD, 130, 0, sigma)).toBeCloseTo(700, 6); // width 10 × 100 − 300
    expect(positionPnl(SPREAD, 80, 0, sigma)).toBeCloseTo(-300, 6); // lose the debit
  });
});

describe("pnlMatrix", () => {
  it("has the requested shape and a normalization scale", () => {
    const m = pnlMatrix(SPREAD, { min: 80, max: 130, dte: 30, sigmaFor: sigma, priceSteps: 11, dateSteps: 6 });
    expect(m.prices).toHaveLength(11);
    expect(m.days).toHaveLength(6);
    expect(m.cells).toHaveLength(11);
    expect(m.cells[0]).toHaveLength(6);
    expect(m.days[0]).toBe(0);
    expect(m.days[m.days.length - 1]).toBe(30);
    expect(m.maxAbs).toBeGreaterThan(0);
  });

  it("last column (expiry) matches the expiry payoff", () => {
    const m = pnlMatrix(SPREAD, { min: 80, max: 130, dte: 30, sigmaFor: sigma, priceSteps: 11, dateSteps: 6 });
    const last = m.days.length - 1;
    m.prices.forEach((price, i) => {
      expect(m.cells[i][last]).toBeCloseTo(payoffAtExpiry(SPREAD, price), 6);
    });
  });
});
