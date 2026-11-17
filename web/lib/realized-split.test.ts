import { describe, expect, it } from "vitest";
import { realizedSplitVerdict, splitBarShares } from "./realized-split";

describe("realizedSplitVerdict", () => {
  it("gives the long-term share when both sides gained", () => {
    const v = realizedSplitVerdict({ longTerm: 830, shortTerm: 170, washLots: [] });
    expect(v.split).toBe("83% of it is long-term.");
    expect(v.wash).toBeNull();
  });

  it("gives the short-term share of a loss when both sides lost", () => {
    expect(realizedSplitVerdict({ longTerm: -25, shortTerm: -75, washLots: [] }).split).toBe(
      "75% of the loss is short-term.",
    );
  });

  it("does not print a share when the sides disagree", () => {
    expect(realizedSplitVerdict({ longTerm: 500, shortTerm: -100, washLots: [] }).split).toBe(
      "Long-term lots gained while short-term lots lost.",
    );
    expect(realizedSplitVerdict({ longTerm: -500, shortTerm: 100, washLots: [] }).split).toBe(
      "Short-term lots gained while long-term lots lost.",
    );
  });

  it("handles a single-sided or flat result", () => {
    expect(realizedSplitVerdict({ longTerm: 10, shortTerm: 0, washLots: [] }).split).toBe(
      "All of it is long-term.",
    );
    expect(realizedSplitVerdict({ longTerm: 0, shortTerm: -10, washLots: [] }).split).toBe(
      "All of the loss is short-term.",
    );
    expect(realizedSplitVerdict({ longTerm: 0, shortTerm: 0, washLots: [] }).split).toBe(
      "Gains and losses cancel out.",
    );
  });

  it("names the ticker for a single wash sale and counts several", () => {
    const one = realizedSplitVerdict({
      longTerm: 1,
      shortTerm: 1,
      washLots: [{ ticker: "AMD", loss: 312.4 }],
    });
    expect(one.wash).toEqual({
      lead: "One AMD loss of",
      amount: 312.4,
      tail: "is disallowed as a wash sale.",
    });
    const two = realizedSplitVerdict({
      longTerm: 1,
      shortTerm: 1,
      washLots: [
        { ticker: "AMD", loss: 100 },
        { ticker: "MU", loss: 50 },
        { ticker: "X", loss: 0 },
      ],
    });
    expect(two.wash).toEqual({
      lead: "2 losses totalling",
      amount: 150,
      tail: "are disallowed as wash sales.",
    });
  });
});

describe("splitBarShares", () => {
  it("splits by magnitude and sums to 100", () => {
    expect(splitBarShares(75, -25)).toEqual({ long: 75, short: 25 });
  });
  it("is empty when there is nothing to split", () => {
    expect(splitBarShares(0, 0)).toEqual({ long: 0, short: 0 });
  });
});
