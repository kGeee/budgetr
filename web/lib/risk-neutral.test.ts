import { describe, it, expect } from "vitest";
import { riskNeutralDensity, scoreUnderDensity, smileFromContracts, type SmilePoint } from "@/lib/risk-neutral";
import { bsPrice } from "@/lib/strategy";
import { type PayoffLeg } from "@/lib/payoff";

const S = 100;
const T = 0.25;
const SIG = 0.3;

// A flat smile → the risk-neutral density is just the lognormal at that vol, so a
// structure priced at that same vol must score EV ≈ 0. This is the invariant the
// old flat-vol scorer violated for butterflies.
const flatSmile: SmilePoint[] = Array.from({ length: 17 }, (_, i) => ({ strike: 60 + i * 5, iv: SIG }));

function leg(right: "call" | "put", strike: number, contracts: number): PayoffLeg {
  const qty = contracts * 100;
  return {
    parsed: { occ: `X${right}${strike}`, underlying: "X", expiry: "20250101", right, strike },
    quantity: qty,
    costBasis: bsPrice(right, S, strike, SIG, T) * qty, // paid (long) / received (short) at fair vol
  };
}

describe("riskNeutralDensity", () => {
  const d = riskNeutralDensity(flatSmile, S, T, SIG)!;

  it("is a valid distribution (non-negative, sums to 1)", () => {
    expect(d).not.toBeNull();
    expect(Math.min(...d.prob)).toBeGreaterThanOrEqual(0);
    expect(d.prob.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("has mean = the forward (spot·e^{rT}) — the no-arbitrage martingale condition", () => {
    const mean = d.support.reduce((acc, x, i) => acc + x * d.prob[i], 0);
    const forward = S * Math.exp(0.045 * T); // RISK_FREE_RATE
    expect(mean).toBeCloseTo(forward, 4);
  });

  it("returns null for a too-sparse smile", () => {
    expect(riskNeutralDensity([{ strike: 100, iv: 0.3 }], S, T, SIG)).toBeNull();
  });
});

describe("scoreUnderDensity — a mid-priced spread nets EV ≈ 0", () => {
  const d = riskNeutralDensity(flatSmile, S, T, SIG)!;

  it("call vertical (long 100 / short 105)", () => {
    const legs = [leg("call", 100, 1), { ...leg("call", 105, 1), quantity: -100 }];
    // fix the short leg's sign on both quantity and premium received
    legs[1] = {
      parsed: { occ: "Xcall105", underlying: "X", expiry: "20250101", right: "call", strike: 105 },
      quantity: -100,
      costBasis: -bsPrice("call", S, 105, SIG, T) * 100,
    };
    const { ev } = scoreUnderDensity(legs, d);
    expect(Math.abs(ev)).toBeLessThan(3); // was wildly negative under flat-ATM scoring
  });

  it("long call butterfly (95 / 2×100 / 105) — the pathological case", () => {
    const legs: PayoffLeg[] = [
      leg("call", 95, 1),
      {
        parsed: { occ: "Xcall100", underlying: "X", expiry: "20250101", right: "call", strike: 100 },
        quantity: -200,
        costBasis: -bsPrice("call", S, 100, SIG, T) * 200,
      },
      leg("call", 105, 1),
    ];
    const { ev, pWin } = scoreUnderDensity(legs, d);
    expect(Math.abs(ev)).toBeLessThan(3); // fairly priced → ~zero EV, not −69%
    expect(pWin).toBeGreaterThan(0.2); // and a sane, non-collapsed win probability
    expect(pWin).toBeLessThan(0.8);
  });
});

describe("smileFromContracts", () => {
  it("keeps one IV per strike, preferring OTM (call above spot, put below)", () => {
    const smile = smileFromContracts(
      [
        { strike: 90, right: "call", iv: 0.5 },
        { strike: 90, right: "put", iv: 0.35 }, // below spot → prefer put
        { strike: 110, right: "call", iv: 0.4 }, // above spot → prefer call
        { strike: 110, right: "put", iv: 0.6 },
      ],
      100,
    );
    expect(smile).toEqual([
      { strike: 90, iv: 0.35 },
      { strike: 110, iv: 0.4 },
    ]);
  });
});
