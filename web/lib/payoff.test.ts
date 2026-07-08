import { describe, it, expect } from "vitest";
import { parseOccSymbol } from "@/lib/options";
import { analyzePayoff, payoffAtExpiry, payoffCurve, type PayoffLeg } from "@/lib/payoff";

// Quantities are in SHARES (contracts × 100), matching what Plaid stores.
const leg = (occ: string, quantity: number, costBasis: number | null): PayoffLeg => ({
  parsed: parseOccSymbol(occ)!,
  quantity,
  costBasis,
});

describe("payoffAtExpiry", () => {
  it("nets long/short call intrinsic minus cost basis", () => {
    // Long 1 contract $100 call paid $500 total.
    const legs = [leg("AAA260101C00100000", 100, 500)];
    expect(payoffAtExpiry(legs, 100)).toBe(-500); // OTM/ATM → lose premium
    expect(payoffAtExpiry(legs, 110)).toBe(500); // 100*10 - 500
  });
});

describe("analyzePayoff — LRCX bull call spread (the reported bug)", () => {
  // Real position: long 410 call (+100 sh, $5431.56 debit), short 430 call
  // (−100 sh, −$4530.35 credit). One contract each; net debit $901.21.
  const legs = [
    leg("LRCX260821C00410000", 100, 5431.56),
    leg("LRCX260821C00430000", -100, -4530.35),
  ];

  it("caps max profit at the strike width minus the net debit", () => {
    const a = analyzePayoff(legs);
    expect(a.maxProfitUnbounded).toBe(false);
    // (430-410)*100 - 901.21 = 1098.79  (NOT the $199,098.79 bug)
    expect(a.maxProfit).toBeCloseTo(1098.79, 2);
  });

  it("limits max loss to the net debit", () => {
    expect(analyzePayoff(legs).maxLoss).toBeCloseTo(901.21, 2);
  });

  it("breaks even a bit above the long strike, not right at it", () => {
    const a = analyzePayoff(legs);
    expect(a.breakevens).toHaveLength(1);
    expect(a.breakevens[0]).toBeCloseTo(419.01, 2); // 410 + 901.21/100
  });

  it("yields a sane reward:risk near 1.2×, not 220×", () => {
    const a = analyzePayoff(legs);
    const rr = a.maxProfit! / a.maxLoss!;
    expect(rr).toBeCloseTo(1.22, 2);
  });
});

describe("analyzePayoff — unbounded tails", () => {
  it("marks a long call's upside unbounded and loss as the premium", () => {
    const a = analyzePayoff([leg("AAA260101C00100000", 100, 500)]);
    expect(a.maxProfitUnbounded).toBe(true);
    expect(a.maxProfit).toBeNull();
    expect(a.maxLoss).toBeCloseTo(500, 2);
    expect(a.breakevens[0]).toBeCloseTo(105, 2); // 100 + 500/100
  });

  it("marks a naked short call's loss unbounded and profit as the credit", () => {
    const a = analyzePayoff([leg("AAA260101C00100000", -100, -300)]);
    expect(a.maxLossUnbounded).toBe(true);
    expect(a.maxLoss).toBeNull();
    expect(a.maxProfit).toBeCloseTo(300, 2);
  });

  it("caps a long put's max profit at strike (S→0) with bounded loss", () => {
    const a = analyzePayoff([leg("AAA260101P00100000", 100, 400)]);
    expect(a.maxProfitUnbounded).toBe(false);
    expect(a.maxProfit).toBeCloseTo(100 * 100 - 400, 2); // strike*shares - premium
    expect(a.maxLoss).toBeCloseTo(400, 2);
    expect(a.breakevens[0]).toBeCloseTo(96, 2); // 100 - 400/100
  });
});

describe("analyzePayoff — put credit spread (two breakevens? no — one)", () => {
  it("handles a bull put (credit) spread", () => {
    // Short 100 put (credit), long 95 put (debit). Net credit.
    const legs = [
      leg("AAA260101P00100000", -100, -300), // sold, received $300
      leg("AAA260101P00095000", 100, 120), // bought, paid $120
    ];
    const a = analyzePayoff(legs);
    // net credit 180; max profit = credit = 180; max loss = width*100 - credit
    expect(a.maxProfit).toBeCloseTo(180, 2);
    expect(a.maxLoss).toBeCloseTo((100 - 95) * 100 - 180, 2); // 500 - 180 = 320
    expect(a.breakevens[0]).toBeCloseTo(100 - 180 / 100, 2); // 98.2
  });
});

describe("analyzePayoff — missing cost basis", () => {
  it("returns null economics when a leg is un-costed", () => {
    const a = analyzePayoff([leg("AAA260101C00100000", 100, null)]);
    expect(a.maxProfit).toBeNull();
    expect(a.maxLoss).toBeNull();
    expect(a.breakevens).toEqual([]);
  });
});

describe("payoffCurve", () => {
  it("returns exact vertices spanning the strikes with a current-price marker", () => {
    const legs = [
      leg("LRCX260821C00410000", 100, 5431.56),
      leg("LRCX260821C00430000", -100, -4530.35),
    ];
    const { points, min, max } = payoffCurve(legs, { center: 420 });
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(430);
    // The two strikes must appear as vertices (kinks).
    expect(points.some((p) => Math.abs(p.price - 410) < 1e-6)).toBe(true);
    expect(points.some((p) => Math.abs(p.price - 430) < 1e-6)).toBe(true);
    // Endpoints clamp the P&L to the plateau values.
    expect(points[0].pnl).toBeCloseTo(-901.21, 2);
    expect(points[points.length - 1].pnl).toBeCloseTo(1098.79, 2);
  });
});
