import { describe, expect, it } from "vitest";
import { accountKind, groupAccountsByKind } from "./account-groups";

type Row = { id: string; type: string; excluded: boolean; value: number };
const row = (id: string, type: string, value: number, excluded = false): Row => ({
  id,
  type,
  excluded,
  value,
});
const signed = (r: Row) => r.value;

describe("accountKind", () => {
  it("maps Plaid account types onto what the money is", () => {
    expect(accountKind("depository")).toBe("cash");
    expect(accountKind("investment")).toBe("investments");
    expect(accountKind("credit")).toBe("cards");
    expect(accountKind("loan")).toBe("loans");
  });

  it("puts anything unrecognised in other", () => {
    expect(accountKind("other")).toBe("other");
    expect(accountKind("brokerage")).toBe("other");
  });
});

describe("groupAccountsByKind", () => {
  it("always returns the four main groups, in reading order, even when empty", () => {
    const groups = groupAccountsByKind<Row>([], signed);
    expect(groups.map((g) => g.kind)).toEqual(["cash", "investments", "cards", "loans"]);
    expect(groups.every((g) => g.rows.length === 0 && g.subtotal === 0)).toBe(true);
  });

  it("adds other only when something lands in it", () => {
    const groups = groupAccountsByKind([row("a", "other", 10)], signed);
    expect(groups.map((g) => g.kind)).toEqual(["cash", "investments", "cards", "loans", "other"]);
    expect(groups[4].rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("subtotals each group from signed values and flags the owed ones", () => {
    const groups = groupAccountsByKind(
      [
        row("chk", "depository", 800),
        row("sav", "depository", 200),
        row("amex", "credit", -150),
        row("visa", "credit", -50),
        row("ira", "investment", 5000),
      ],
      signed,
    );
    const by = Object.fromEntries(groups.map((g) => [g.kind, g]));
    expect(by.cash.subtotal).toBe(1000);
    expect(by.cash.owed).toBe(false);
    expect(by.investments.subtotal).toBe(5000);
    expect(by.cards.subtotal).toBe(-200);
    expect(by.cards.owed).toBe(true);
    expect(by.loans.owed).toBe(true);
  });

  it("leaves hidden accounts out of the subtotal but keeps them listed, last", () => {
    const [cash] = groupAccountsByKind(
      [row("old", "depository", 999, true), row("chk", "depository", 100), row("sav", "depository", 50)],
      signed,
    );
    expect(cash.subtotal).toBe(150);
    expect(cash.hiddenCount).toBe(1);
    expect(cash.rows.map((r) => r.id)).toEqual(["chk", "sav", "old"]);
  });
});
