import { describe, it, expect } from "vitest";
import { computeGreeks } from "@/lib/greeks";
import { parseOccSymbol } from "@/lib/options";

// Far-future expiry so days-to-expiry stays positive whenever the suite runs.
const call = parseOccSymbol("AAA991218C00100000")!; // $100 call, exp 2099-12-18
const put = parseOccSymbol("AAA991218P00100000")!; // $100 put

describe("computeGreeks", () => {
  it("produces sane Greeks for an at-the-money call", () => {
    const g = computeGreeks(call, 100, 0.3);
    expect(g.delta).toBeGreaterThan(0);
    expect(g.delta).toBeLessThan(1);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
  });

  it("gives a put a negative delta, with call − put delta ≈ 1", () => {
    const c = computeGreeks(call, 100, 0.3);
    const p = computeGreeks(put, 100, 0.3);
    expect(p.delta).toBeLessThan(0);
    expect(p.delta).toBeGreaterThan(-1);
    expect((c.delta as number) - (p.delta as number)).toBeCloseTo(1, 6);
  });

  it("returns all-null Greeks when price or IV is unusable", () => {
    expect(computeGreeks(call, null, 0.3).delta).toBeNull();
    expect(computeGreeks(call, 100, 0).delta).toBeNull();
    expect(computeGreeks(call, 100, undefined).delta).toBeNull();
  });
});
