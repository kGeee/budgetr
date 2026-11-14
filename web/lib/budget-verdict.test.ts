import { describe, expect, it } from "vitest";
import { budgetVerdict } from "./budget-verdict";

const base = { month: "2026-07", totalBudget: 3100 };

describe("budgetVerdict", () => {
  it("says nothing without a budget", () => {
    expect(budgetVerdict({ ...base, totalBudget: 0, today: "2026-07-15", totalSpent: 50 })).toBeNull();
  });

  it("reports the gap under an even pace mid-month", () => {
    // Day 15 of 31 → an even burn of 3100 is 1500 so far.
    const v = budgetVerdict({ ...base, today: "2026-07-15", totalSpent: 1000 });
    expect(v).toMatchObject({ tone: "jade", lead: "Spending is" });
    expect(v!.amount).toBeCloseTo(500, 6);
    expect(v!.tail).toBe("under an even pace, with 16 days left.");
    expect(v!.projectedOver).toBeUndefined();
  });

  it("warns when ahead of pace and projects the overshoot", () => {
    const v = budgetVerdict({ ...base, today: "2026-07-15", totalSpent: 2000 });
    expect(v!.tone).toBe("brass");
    expect(v!.amount).toBeCloseTo(500, 6);
    // 2000 over 15 days → 4133.33 by day 31.
    expect(v!.projectedOver).toBeCloseTo((2000 / 15) * 31 - 3100, 6);
  });

  it("states the overage once the budget is blown", () => {
    const v = budgetVerdict({ ...base, today: "2026-07-30", totalSpent: 3250 });
    expect(v).toMatchObject({ tone: "coral", tail: "over budget with 1 day left." });
    expect(v!.amount).toBeCloseTo(150, 6);
  });

  it("gives a result, not a pace, for a month that is not the current one", () => {
    const v = budgetVerdict({ ...base, today: "2026-11-13", totalSpent: 2900 });
    expect(v).toMatchObject({ tone: "jade", lead: "The month closed", tail: "under budget." });
    expect(v!.amount).toBeCloseTo(200, 6);
  });

  it("treats the last day of the month as closed", () => {
    const v = budgetVerdict({ ...base, today: "2026-07-31", totalSpent: 3000 });
    expect(v!.lead).toBe("The month closed");
  });
});
