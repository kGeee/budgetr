import { describe, expect, it } from "vitest";
import {
  analyzeChainForLeaps,
  analyzeLeap,
  compareToShares,
  midOrLast,
  priceLadder,
  type LeapsInputs,
} from "@/lib/quant/leaps";

/** A deep ITM two-year call on a $100 stock — the classic stock replacement. */
const DEEP_ITM: LeapsInputs = {
  spot: 100,
  strike: 70,
  premium: 36,
  dte: 730,
  iv: 0.28,
  dividendYield: 0,
  rate: 0.045,
};

describe("analyzeLeap", () => {
  it("splits the premium into intrinsic and extrinsic", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    expect(a.intrinsic).toBe(30); // 100 − 70
    expect(a.extrinsic).toBeCloseTo(6, 10); // 36 − 30
    expect(a.extrinsicPctOfSpot).toBeCloseTo(0.06, 10);
  });

  it("quotes the financing rate against the capital freed, not the strike", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    // Freed capital is S − P = 64; cost is the 6 of extrinsic over 2 years.
    expect(a.financedAmount).toBe(64);
    expect(a.impliedFinancingRate).toBeCloseTo(6 / 64 / 2, 10); // ≈ 4.69%/yr
  });

  it("nets the interest the freed capital earns against the option's cost", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    expect(a.interestOnFreedCapital).toBeCloseTo(64 * 0.045 * 2, 10); // 5.76
    expect(a.netCarry).toBeCloseTo(6 - 5.76, 10); // 0.24/share — nearly a wash
    expect(a.netCarryRate).toBeCloseTo(a.impliedFinancingRate! - 0.045, 10);
  });

  it("charges forgone dividends to the option holder", () => {
    const withDiv = analyzeLeap({ ...DEEP_ITM, dividendYield: 0.02 })!;
    const without = analyzeLeap(DEEP_ITM)!;
    expect(withDiv.forgoneDividends).toBeCloseTo(0.02 * 100 * 2, 10); // $4/share
    expect(withDiv.financingCost - without.financingCost).toBeCloseTo(4, 10);
    // Dividends make the call strictly worse against the shares.
    expect(withDiv.trailsSharesAboveStrikeBy).toBeGreaterThan(without.trailsSharesAboveStrikeBy);
  });

  it("reports a constant gap above the strike, because both slopes are 1", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    const pts = compareToShares(DEEP_ITM, a, [80, 120, 200, 400]);
    const gaps = pts
      .filter((p) => p.price > DEEP_ITM.strike)
      .map((p) => (p.shares - p.leap) / 100);
    // Every gap above the strike is the same number, and it's the one reported.
    for (const g of gaps) expect(g).toBeCloseTo(a.trailsSharesAboveStrikeBy, 8);
    expect(new Set(gaps.map((g) => g.toFixed(6))).size).toBe(1);
  });

  it("finds the downside price where the call wins, and agrees with the curves", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    const cross = a.leapWinsBelow;
    const [below, above] = compareToShares(DEEP_ITM, a, [cross - 5, cross + 5]);
    expect(below.leap).toBeGreaterThan(below.shares);
    expect(above.shares).toBeGreaterThan(above.leap);
    // And at the crossing itself the two are equal.
    const [at] = compareToShares(DEEP_ITM, a, [cross]);
    expect(at.leap).toBeCloseTo(at.shares, 6);
  });

  it("puts breakeven at strike plus premium", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    expect(a.breakeven).toBe(106);
    expect(a.breakevenMovePct).toBeCloseTo(0.06, 10);
  });

  it("caps the loss at the premium while the shares keep falling", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    expect(a.maxLoss).toBe(3600);
    expect(a.worthlessAtOrBelow).toBe(70);
    expect(a.sharesLossAtThatPrice).toBeCloseTo(0.3, 10); // shares −30% at $70
  });

  it("derives delta from IV when the feed doesn't supply one, and prefers it when it does", () => {
    const derived = analyzeLeap(DEEP_ITM)!;
    expect(derived.delta).toBeGreaterThan(0.7); // deep ITM, two years out
    expect(derived.delta).toBeLessThan(1);
    expect(derived.deltaEquivalentShares).toBeCloseTo(derived.delta! * 100, 10);

    const supplied = analyzeLeap({ ...DEEP_ITM, delta: 0.5 })!;
    expect(supplied.delta).toBe(0.5);
  });

  it("reports leverage as exposure per dollar outlaid", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    expect(a.effectiveLeverage).toBeCloseTo((a.delta! * 100) / 36, 10);
    expect(a.effectiveLeverage).toBeGreaterThan(1);
  });

  it("shows a long-dated contract decaying slowly", () => {
    const a = analyzeLeap(DEEP_ITM)!;
    expect(a.thetaPerDay).toBeLessThan(0);
    // A two-year contract should shed only a small slice of premium in a month.
    expect(a.thetaPctOfPremiumPerMonth).toBeLessThan(0.03);
  });

  it("prices an OTM lottery ticket as mostly extrinsic with a low win probability", () => {
    const otm = analyzeLeap({ ...DEEP_ITM, strike: 150, premium: 6 })!;
    expect(otm.intrinsic).toBe(0);
    expect(otm.extrinsic).toBe(6);
    expect(otm.probAboveBreakeven!).toBeLessThan(0.3);
  });

  it("refuses to quote a financing rate on a call that isn't a stock replacement", () => {
    const itm = analyzeLeap(DEEP_ITM)!;
    const otm = analyzeLeap({ ...DEEP_ITM, strike: 150, premium: 6 })!;

    expect(itm.isStockReplacement).toBe(true);
    expect(itm.impliedFinancingRate).not.toBeNull();

    // Quoting extrinsic ÷ (spot − premium) on an OTM strike would make this $6
    // lottery ticket look like *cheaper* borrowing than the deep ITM
    // replacement — the denominator pretends it delivers 100 shares of
    // exposure when its delta plainly doesn't.
    expect(otm.isStockReplacement).toBe(false);
    expect(otm.impliedFinancingRate).toBeNull();
  });

  it("ranks strikes honestly once cost is per unit of exposure bought", () => {
    const itm = analyzeLeap(DEEP_ITM)!;
    const otm = analyzeLeap({ ...DEEP_ITM, strike: 150, premium: 6 })!;
    // Same $6 of extrinsic, but the OTM call buys far less exposure with it.
    expect(otm.costPerExposureRate!).toBeGreaterThan(itm.costPerExposureRate!);
  });

  it("rejects inputs that can't describe a trade", () => {
    expect(analyzeLeap({ ...DEEP_ITM, spot: 0 })).toBeNull();
    expect(analyzeLeap({ ...DEEP_ITM, premium: 0 })).toBeNull();
    expect(analyzeLeap({ ...DEEP_ITM, dte: 0 })).toBeNull();
  });

  it("degrades to null fields rather than failing when IV is missing", () => {
    const a = analyzeLeap({ ...DEEP_ITM, iv: null })!;
    expect(a.delta).toBeNull();
    expect(a.thetaPerDay).toBeNull();
    expect(a.probAboveBreakeven).toBeNull();
    // The carry maths needs no vol at all, so it still answers.
    expect(a.impliedFinancingRate).toBeCloseTo(6 / 64 / 2, 10);
  });
});

describe("compareToShares", () => {
  it("credits the shares with dividends and the call with interest", () => {
    const input = { ...DEEP_ITM, dividendYield: 0.03 };
    const a = analyzeLeap(input)!;
    const [flat] = compareToShares(input, a, [input.spot]);
    // Flat stock: shares collect two years of dividends and nothing else.
    expect(flat.shares).toBeCloseTo(0.03 * 100 * 2 * 100, 6);
    // The call is worth its intrinsic minus premium, plus interest on the cash.
    expect(flat.leap).toBeCloseTo((30 - 36 + a.interestOnFreedCapital) * 100, 6);
  });
});

describe("priceLadder", () => {
  it("spans symmetrically around spot and never goes negative", () => {
    const ladder = priceLadder(100, 0.5, 11);
    expect(ladder).toHaveLength(11);
    expect(ladder[0]).toBeCloseTo(50, 10);
    expect(ladder.at(-1)).toBeCloseTo(150, 10);
    expect(priceLadder(0.5, 2, 5)[0]).toBeGreaterThan(0);
  });
});

describe("midOrLast", () => {
  const base = { occ: "X", expiry: "2027-01-15", strike: 70, right: "call" as const, iv: null, openInterest: null };

  it("prefers the mid when both sides quote", () => {
    expect(midOrLast({ ...base, bid: 10, ask: 12, last: 30 })).toBe(11);
  });

  it("falls back to last when a side is missing or zero", () => {
    expect(midOrLast({ ...base, bid: null, ask: 12, last: 9 })).toBe(9);
    expect(midOrLast({ ...base, bid: 0, ask: 12, last: 9 })).toBe(9);
    expect(midOrLast({ ...base, bid: null, ask: null, last: null })).toBeNull();
  });
});

describe("analyzeChainForLeaps", () => {
  const dteFor = (expiry: string) => ({ "2026-09-18": 45, "2027-06-17": 320, "2028-01-21": 540 })[expiry] ?? 0;

  const rows = [
    // Near-dated: excluded however attractive it looks.
    { occ: "A", expiry: "2026-09-18", strike: 95, right: "call" as const, bid: 8, ask: 8.4, last: 8.2, iv: 0.3, openInterest: 100 },
    // Just under a year: also excluded at the default threshold.
    { occ: "B", expiry: "2027-06-17", strike: 90, right: "call" as const, bid: 16, ask: 16.6, last: 16, iv: 0.29, openInterest: 50 },
    { occ: "C", expiry: "2028-01-21", strike: 80, right: "call" as const, bid: 28, ask: 29, last: 28.5, iv: 0.28, openInterest: 20 },
    { occ: "D", expiry: "2028-01-21", strike: 120, right: "call" as const, bid: 9, ask: 9.4, last: 9, iv: 0.31, openInterest: 5 },
    // Puts are not stock replacements.
    { occ: "E", expiry: "2028-01-21", strike: 80, right: "put" as const, bid: 5, ask: 5.4, last: 5, iv: 0.3, openInterest: 10 },
    // Unpriceable.
    { occ: "F", expiry: "2028-01-21", strike: 100, right: "call" as const, bid: null, ask: null, last: null, iv: 0.3, openInterest: 0 },
  ];

  it("keeps only long-dated, priceable calls, sorted by expiry then strike", () => {
    const got = analyzeChainForLeaps(rows, { spot: 100, dteFor });
    expect(got.map((c) => c.occ)).toEqual(["C", "D"]);
    expect(got[0].dte).toBe(540);
    expect(got[0].premium).toBeCloseTo(28.5, 10); // mid of 28/29
  });

  it("honours a custom threshold", () => {
    const got = analyzeChainForLeaps(rows, { spot: 100, dteFor, minDte: 300 });
    expect(got.map((c) => c.occ)).toEqual(["B", "C", "D"]);
  });

  it("returns empty rather than falling back to near-dated contracts", () => {
    const nearOnly = rows.filter((r) => r.expiry === "2026-09-18");
    expect(analyzeChainForLeaps(nearOnly, { spot: 100, dteFor })).toEqual([]);
  });
});
