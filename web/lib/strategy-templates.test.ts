import { describe, it, expect } from "vitest";
import { buildTemplate, STRATEGY_TEMPLATES } from "./strategy-templates";

// A typical evenly-spaced strike grid straddling a $100 spot.
const STRIKES = [85, 90, 95, 100, 105, 110, 115];
const SPOT = 101; // closest strike is 100 (ATM)

describe("buildTemplate", () => {
  it("long call = one long ATM call", () => {
    const legs = buildTemplate("long-call", STRIKES, SPOT)!;
    expect(legs).toEqual([{ right: "call", strike: 100, contracts: 1 }]);
  });

  it("bull call spread = long ATM call, short higher call, net one lot each way", () => {
    const legs = buildTemplate("bull-call", STRIKES, SPOT)!;
    expect(legs).toEqual([
      { right: "call", strike: 100, contracts: 1 },
      { right: "call", strike: 110, contracts: -1 },
    ]);
  });

  it("iron condor = 4 legs, contracts net to zero (defined risk)", () => {
    const legs = buildTemplate("iron-condor", STRIKES, SPOT)!;
    expect(legs).toHaveLength(4);
    expect(legs.reduce((s, l) => s + l.contracts, 0)).toBe(0);
    // Short strikes inside, long wings outside.
    const puts = legs.filter((l) => l.right === "put").sort((a, b) => a.strike - b.strike);
    expect(puts[0].contracts).toBe(1); // far OTM long put (wing)
    expect(puts[1].contracts).toBe(-1); // near OTM short put
  });

  it("returns null when the grid lacks room for the wings", () => {
    expect(buildTemplate("iron-condor", [95, 100, 105], 100)).toBeNull();
  });

  it("every catalog template builds on a wide grid", () => {
    const wide = Array.from({ length: 21 }, (_, i) => 50 + i * 5); // 50…150
    for (const t of STRATEGY_TEMPLATES) {
      expect(buildTemplate(t.key, wide, 100), t.key).not.toBeNull();
    }
  });
});
