import { describe, expect, it } from "vitest";
import { openLedger, splitMethodLabel } from "./shared-ledger";

const share = (personId: string, amount: number) => ({ personId, amount });
const expense = (
  id: string,
  date: string,
  shares: { personId: string; amount: number }[],
  myShare = 0,
  itemsJson: string | null = null,
) => ({ id, date, displayName: id, myShare, itemsJson, shares });

describe("splitMethodLabel", () => {
  it("counts you among an even split", () => {
    expect(splitMethodLabel(expense("a", "2026-07-12", [share("p", 20), share("q", 20)], 20))).toBe(
      "Evenly, 3",
    );
  });

  it("treats a one-cent remainder as even", () => {
    expect(
      splitMethodLabel(expense("a", "2026-07-12", [share("p", 3.33), share("q", 3.33)], 3.34)),
    ).toBe("Evenly, 3");
  });

  it("reads unequal shares as amounts", () => {
    expect(splitMethodLabel(expense("a", "2026-07-12", [share("p", 80), share("q", 80)], 40))).toBe(
      "Amounts",
    );
  });

  it("leaves you out when your share is nothing", () => {
    expect(splitMethodLabel(expense("a", "2026-07-12", [share("p", 50)], 0))).toBe("Evenly, 1");
  });

  it("knows a receipt split from its stored line items", () => {
    expect(splitMethodLabel(expense("a", "2026-07-12", [share("p", 12), share("q", 31)], 9, "[]"))).toBe(
      "By item",
    );
  });

  it("ignores the sign of stored amounts", () => {
    expect(splitMethodLabel(expense("a", "2026-07-12", [share("p", -20)], -20))).toBe("Evenly, 2");
  });
});

describe("openLedger", () => {
  const expenses = [
    expense("old", "2026-06-01", [share("sam", 100)]),
    expense("mid", "2026-06-20", [share("sam", 40), share("alex", 40)]),
    expense("new", "2026-07-12", [share("sam", 30), share("alex", 30)]),
  ];

  it("puts what is still owed on the newest shares", () => {
    // Sam owed 170 in all and has paid 120 back: the oldest 100 and 20 of the next.
    const { byExpense, byPerson } = openLedger(expenses, [
      { id: "sam", balance: 50 },
      { id: "alex", balance: 0 },
    ]);
    expect(byPerson.get("sam")).toEqual([
      { expenseId: "new", displayName: "new", date: "2026-07-12", amount: 30 },
      { expenseId: "mid", displayName: "mid", date: "2026-06-20", amount: 20 },
    ]);
    expect(byPerson.has("alex")).toBe(false);
    expect(byExpense.get("new")).toBe(30);
    expect(byExpense.get("mid")).toBe(20);
    expect(byExpense.get("old")).toBe(0);
  });

  it("sums an expense's outstanding across its people", () => {
    const { byExpense } = openLedger(expenses, [
      { id: "sam", balance: 30 },
      { id: "alex", balance: 70 },
    ]);
    expect(byExpense.get("new")).toBe(60);
    expect(byExpense.get("mid")).toBe(40);
    expect(byExpense.get("old")).toBe(0);
  });

  it("marks everything repaid for someone square or overpaid", () => {
    const { byExpense, byPerson } = openLedger(expenses, [
      { id: "sam", balance: 0 },
      { id: "alex", balance: -18.5 },
    ]);
    expect([...byExpense.values()]).toEqual([0, 0, 0]);
    expect(byPerson.size).toBe(0);
  });

  it("does not depend on the order expenses arrive in", () => {
    const { byExpense } = openLedger([...expenses].reverse().reverse().sort(() => 0), [
      { id: "sam", balance: 50 },
    ]);
    const shuffled = openLedger([expenses[1], expenses[2], expenses[0]], [{ id: "sam", balance: 50 }]);
    expect(Object.fromEntries(shuffled.byExpense)).toEqual(Object.fromEntries(byExpense));
  });
});
