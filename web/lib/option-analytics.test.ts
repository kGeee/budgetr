import { describe, it, expect } from "vitest";
import { parseOccSymbol } from "@/lib/options";
import { analyzePayoff, type PayoffLeg } from "@/lib/payoff";
import { expectedMove, probabilityOfProfit } from "@/lib/option-analytics";

const leg = (occ: string, quantity: number, costBasis: number | null): PayoffLeg => ({
  parsed: parseOccSymbol(occ)!,
  quantity,
  costBasis,
});

describe("expectedMove", () => {
  it("is spot · σ · √T", () => {
    expect(expectedMove(100, 0.2, 1)).toBeCloseTo(20, 6); // 100 * 0.2 * 1
    expect(expectedMove(100, 0.2, 0.25)).toBeCloseTo(10, 6); // √0.25 = 0.5
  });
  it("returns null on bad inputs", () => {
    expect(expectedMove(null, 0.2, 1)).toBeNull();
    expect(expectedMove(100, 0, 1)).toBeNull();
    expect(expectedMove(100, 0.2, 0)).toBeNull();
  });
});

describe("probabilityOfProfit", () => {
  it("is below 50% for an OTM-breakeven long call bought at the money", () => {
    const legs = [leg("AAA260101C00100000", 100, 500)]; // breakeven 105 > spot 100
    const a = analyzePayoff(legs);
    const pop = probabilityOfProfit(legs, a, 100, 0.3, 0.5)!;
    expect(pop).toBeGreaterThan(0);
    expect(pop).toBeLessThan(0.5);
  });

  it("is high for a deep-OTM short put (small width of loss above breakeven)", () => {
    // Sold a $80 put for $100 while spot is $100 → breakeven $79, profit if S>79.
    const legs = [leg("AAA260101P00080000", -100, -100)];
    const a = analyzePayoff(legs);
    const pop = probabilityOfProfit(legs, a, 100, 0.3, 0.5)!;
    expect(pop).toBeGreaterThan(0.7);
  });

  it("complements between a long call and the opposing short call at the same breakeven", () => {
    const spot = 100;
    const longLegs = [leg("AAA260101C00100000", 100, 500)];
    const shortLegs = [leg("AAA260101C00100000", -100, -500)];
    const popLong = probabilityOfProfit(longLegs, analyzePayoff(longLegs), spot, 0.3, 0.5)!;
    const popShort = probabilityOfProfit(shortLegs, analyzePayoff(shortLegs), spot, 0.3, 0.5)!;
    expect(popLong + popShort).toBeCloseTo(1, 6); // same breakeven, opposite regions
  });

  it("returns null without a usable vol / spot", () => {
    const legs = [leg("AAA260101C00100000", 100, 500)];
    const a = analyzePayoff(legs);
    expect(probabilityOfProfit(legs, a, null, 0.3, 0.5)).toBeNull();
    expect(probabilityOfProfit(legs, a, 100, 0, 0.5)).toBeNull();
  });
});
