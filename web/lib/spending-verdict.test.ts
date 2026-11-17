import { describe, expect, it } from "vitest";
import { spendingVerdict } from "./spending-verdict";

describe("spendingVerdict", () => {
  it("says nothing for an empty period", () => {
    expect(spendingVerdict({ income: 0, expenses: 0, txCount: 0 })).toBeNull();
  });

  it("states what was kept and its share of income", () => {
    const v = spendingVerdict({ income: 5000, expenses: 3750, txCount: 40 });
    expect(v).toMatchObject({ tone: "jade", lead: "You kept" });
    expect(v!.amount).toBeCloseTo(1250, 6);
    expect(v!.tail).toBe("of what came in — 25% of income.");
  });

  it("states the shortfall when spending outran income", () => {
    const v = spendingVerdict({ income: 3000, expenses: 3400, txCount: 12 });
    expect(v).toMatchObject({ tone: "coral", lead: "You spent", tail: "more than came in." });
    expect(v!.amount).toBeCloseTo(400, 6);
  });

  it("treats breaking even as kept, not overspent", () => {
    const v = spendingVerdict({ income: 2000, expenses: 2000, txCount: 5 });
    expect(v).toMatchObject({ tone: "jade", amount: 0 });
  });

  it("does not compute a share without income", () => {
    const v = spendingVerdict({ income: 0, expenses: 820, txCount: 9 });
    expect(v).toMatchObject({ tone: "muted", amount: 820 });
    expect(v!.tail).toBe("came out of what you already had.");
  });

  it("says nothing when transactions exist but neither side moved", () => {
    expect(spendingVerdict({ income: 0, expenses: 0, txCount: 3 })).toBeNull();
  });
});
