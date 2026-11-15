import { describe, expect, it } from "vitest";
import { budgetStatus, budgetVerdict, paceSeries } from "./budget-verdict";

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

describe("budgetVerdict with fixed budgets", () => {
  // 2800 of rent on top of 2530 of flexible budgets; rent is paid on the 1st.
  const fixed = { month: "2026-07", totalBudget: 5330, fixedBudget: 2800 };

  it("is unchanged when nothing is flagged fixed", () => {
    const plain = budgetVerdict({ ...base, today: "2026-07-15", totalSpent: 1000 });
    const zeroed = budgetVerdict({
      ...base,
      today: "2026-07-15",
      totalSpent: 1000,
      fixedBudget: 0,
      fixedSpent: 0,
    });
    expect(zeroed).toEqual(plain);
    expect(plain!.scope).toBe("all");
    expect(plain!.lead).toBe("Spending is");
  });

  it("judges pace on flexible spending only", () => {
    // Whole month: 3034.85 against an even 2579 by day 15 — "ahead". Flexible
    // alone: 417.27 against 2530 × 15/31 = 1224.19 — comfortably under.
    const v = budgetVerdict({
      ...fixed,
      today: "2026-07-15",
      totalSpent: 3034.85,
      fixedSpent: 2617.58,
    });
    expect(v).toMatchObject({ tone: "jade", scope: "flexible", lead: "Flexible spending is" });
    expect(v!.amount).toBeCloseTo((2530 * 15) / 31 - 417.27, 6);
    expect(
      budgetVerdict({ month: "2026-07", totalBudget: 5330, today: "2026-07-15", totalSpent: 3034.85 })!
        .tone,
    ).toBe("brass");
  });

  it("ignores an overspent fixed bill when flexible spending is fine", () => {
    const v = budgetVerdict({ ...fixed, today: "2026-07-15", totalSpent: 3400, fixedSpent: 3000 });
    expect(v).toMatchObject({ tone: "jade", scope: "flexible" });
  });

  it("reports flexible overspend and projection in flexible terms", () => {
    const ahead = budgetVerdict({ ...fixed, today: "2026-07-15", totalSpent: 4800, fixedSpent: 2800 });
    expect(ahead).toMatchObject({ tone: "brass", lead: "Flexible spending is" });
    expect(ahead!.projectedOver).toBeCloseTo((2000 / 15) * 31 - 2530, 6);

    const over = budgetVerdict({ ...fixed, today: "2026-07-20", totalSpent: 5500, fixedSpent: 2800 });
    expect(over).toMatchObject({ tone: "coral", lead: "Flexible spending is" });
    expect(over!.amount).toBeCloseTo(170, 6);
  });

  it("names flexible spending when a past month closed", () => {
    const v = budgetVerdict({ ...fixed, today: "2026-11-13", totalSpent: 5000, fixedSpent: 2800 });
    expect(v).toMatchObject({ lead: "Flexible spending closed", tail: "under budget." });
    expect(v!.amount).toBeCloseTo(330, 6);
  });

  it("falls back to the whole month when every budget is fixed", () => {
    const v = budgetVerdict({
      month: "2026-07",
      today: "2026-07-15",
      totalBudget: 2800,
      totalSpent: 1000,
      fixedBudget: 2800,
      fixedSpent: 1000,
    });
    expect(v).toMatchObject({ scope: "all", lead: "Spending is" });
  });
});

describe("budgetStatus", () => {
  const half = 15 / 31;

  it("has nothing to say without a budget", () => {
    expect(budgetStatus({ spent: 40, budget: 0, fixed: false, elapsed: half })).toBeNull();
  });

  it("holds a flexible budget to an even pace", () => {
    expect(budgetStatus({ spent: 175, budget: 850, fixed: false, elapsed: half })).toEqual({
      label: "Under pace",
      tone: "jade",
    });
    expect(budgetStatus({ spent: 600, budget: 850, fixed: false, elapsed: half })!.label).toBe(
      "Ahead of pace",
    );
    expect(budgetStatus({ spent: 0, budget: 300, fixed: false, elapsed: half })!.label).toBe(
      "Untouched",
    );
    expect(budgetStatus({ spent: 900, budget: 850, fixed: false, elapsed: half })).toEqual({
      label: "Over",
      tone: "coral",
    });
  });

  it("judges a closed month against the limit, not a pace", () => {
    expect(budgetStatus({ spent: 800, budget: 850, fixed: false, elapsed: 1 })!.label).toBe(
      "Under budget",
    );
  });

  it("reads a fixed budget as paid or not, never as pace", () => {
    expect(budgetStatus({ spent: 2617.58, budget: 2800, fixed: true, elapsed: 1 / 31 })).toEqual({
      label: "Paid",
      tone: "brass",
    });
    expect(budgetStatus({ spent: 900, budget: 2800, fixed: true, elapsed: half })!.label).toBe(
      "Part paid",
    );
    expect(budgetStatus({ spent: 0, budget: 2800, fixed: true, elapsed: half })!.label).toBe(
      "Not yet paid",
    );
    expect(budgetStatus({ spent: 2900, budget: 2800, fixed: true, elapsed: half })!.tone).toBe(
      "coral",
    );
  });
});

describe("paceSeries", () => {
  const rows = [
    { categoryId: "rent", date: "2026-07-01", spent: 2450 },
    { categoryId: "food", date: "2026-07-02", spent: 40 },
    { categoryId: "food", date: "2026-07-10", spent: 60 },
    { categoryId: "fun", date: "2026-07-10", spent: 25 },
    { categoryId: "food", date: "2026-07-20", spent: 999 }, // after "today"
  ];

  it("accumulates every category up to today and leaves the rest null", () => {
    const s = paceSeries({ month: "2026-07", today: "2026-07-15", budget: 3100, rows });
    expect(s.data).toHaveLength(31);
    expect(s.data[0]).toEqual({ date: "2026-07-01", spent: 2450, pace: 100 });
    expect(s.data[14].spent).toBe(2575);
    expect(s.data[15].spent).toBeNull();
    expect(s.spentToDate).toBe(2575);
    expect(s.paceToDate).toBeCloseTo(1500, 6);
    expect(s.aheadOfPace).toBe(true);
    expect(s.projected).toBeCloseTo((2575 / 15) * 31, 6);
    expect(s.current).toBe(true);
  });

  it("leaves fixed categories out when asked to", () => {
    const s = paceSeries({
      month: "2026-07",
      today: "2026-07-15",
      budget: 620,
      rows,
      include: (id) => id !== "rent",
    });
    expect(s.spentToDate).toBe(125);
    expect(s.paceToDate).toBeCloseTo(300, 6);
    expect(s.aheadOfPace).toBe(false);
  });

  it("runs the actual line to month end for a closed month", () => {
    const s = paceSeries({ month: "2026-07", today: "2026-11-13", budget: 3100, rows });
    expect(s.current).toBe(false);
    expect(s.lastActualDay).toBe(31);
    expect(s.data[30].spent).toBe(3574);
  });
});
