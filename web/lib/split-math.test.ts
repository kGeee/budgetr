import { describe, it, expect } from "vitest";
import { computeSplit, type SplitParticipant } from "@/lib/split-math";

const me: SplitParticipant = { personId: null };
const p = (id: string, value?: number): SplitParticipant => ({ personId: id, value });

/** Total of every slice, rounded the way currency comparisons should be. */
function sum(split: { myShare: number; shares: { amount: number }[] }): number {
  return Math.round((split.myShare + split.shares.reduce((a, s) => a + s.amount, 0)) * 100) / 100;
}

function unwrap(res: ReturnType<typeof computeSplit>) {
  if (!res.ok) throw new Error(`expected ok, got: ${res.error}`);
  return res.split;
}

describe("computeSplit — even", () => {
  it("splits a clean total evenly across everyone including you", () => {
    const split = unwrap(computeSplit(120, "even", [me, p("a"), p("b")]));
    expect(split.myShare).toBe(40);
    expect(split.shares).toEqual([
      { personId: "a", amount: 40 },
      { personId: "b", amount: 40 },
    ]);
  });

  it("never loses a cent on a total that doesn't divide evenly", () => {
    const split = unwrap(computeSplit(100, "even", [me, p("a"), p("b")]));
    expect(sum(split)).toBe(100);
    // 33.33 / 33.33 / 33.34 — the stray cent lands on exactly one participant.
    const all = [split.myShare, ...split.shares.map((s) => s.amount)];
    expect(all.filter((a) => a === 33.34)).toHaveLength(1);
    expect(all.filter((a) => a === 33.33)).toHaveLength(2);
  });

  it("gives you nothing when you paid but aren't part of the split", () => {
    const split = unwrap(computeSplit(60, "even", [p("a"), p("b")]));
    expect(split.myShare).toBe(0);
    expect(sum(split)).toBe(60);
  });

  it("reconciles across a range of awkward totals and party sizes", () => {
    for (const total of [0.01, 0.05, 9.99, 43.21, 100.03, 1234.56]) {
      for (let n = 1; n <= 7; n++) {
        const split = unwrap(
          computeSplit(total, "even", [me, ...Array.from({ length: n }, (_, i) => p(`p${i}`))]),
        );
        expect(sum(split)).toBe(total);
      }
    }
  });
});

describe("computeSplit — amounts", () => {
  it("leaves you the remainder after everyone else's exact figures", () => {
    const split = unwrap(computeSplit(120, "amounts", [p("a", 30), p("b", 45.5)]));
    expect(split.myShare).toBe(44.5);
    expect(sum(split)).toBe(120);
  });

  it("lets the others cover the whole bill, leaving you zero", () => {
    const split = unwrap(computeSplit(50, "amounts", [p("a", 20), p("b", 30)]));
    expect(split.myShare).toBe(0);
  });

  it("rejects shares that exceed the total", () => {
    const res = computeSplit(50, "amounts", [p("a", 40), p("b", 30)]);
    expect(res.ok).toBe(false);
  });

  it("rejects a zero share rather than silently dropping the person", () => {
    expect(computeSplit(50, "amounts", [p("a", 0)]).ok).toBe(false);
  });
});

describe("computeSplit — percent", () => {
  it("allocates by percentage without losing a cent", () => {
    const split = unwrap(computeSplit(99.99, "percent", [
      { personId: null, value: 50 },
      p("a", 25),
      p("b", 25),
    ]));
    expect(sum(split)).toBe(99.99);
    expect(split.myShare).toBeCloseTo(50, 1);
  });

  it("rejects percentages that don't add to 100", () => {
    const res = computeSplit(100, "percent", [{ personId: null, value: 50 }, p("a", 30)]);
    expect(res.ok).toBe(false);
  });
});

describe("computeSplit — guards", () => {
  it("requires at least one other person", () => {
    expect(computeSplit(100, "even", [me]).ok).toBe(false);
  });

  it("refuses to put you in the split twice", () => {
    expect(computeSplit(100, "even", [me, me, p("a")]).ok).toBe(false);
  });

  it("preserves sign on a refunded shared expense", () => {
    // A negative parent (money back in) splits the same way, sign intact.
    const split = unwrap(computeSplit(-90, "even", [me, p("a"), p("b")]));
    expect(split.myShare).toBe(-30);
    expect(split.shares.every((s) => s.amount === -30)).toBe(true);
    expect(sum(split)).toBe(-90);
  });
});
