import { describe, expect, it } from "vitest";
import { accountsVerdict } from "./accounts-verdict";

describe("accountsVerdict", () => {
  it("says nothing with no counted accounts", () => {
    expect(accountsVerdict({ count: 0, assets: 0, liabilities: 0 })).toBeNull();
  });

  it("names the debt netted out of the figure", () => {
    expect(accountsVerdict({ count: 4, assets: 52000, liabilities: 4210.5 })).toEqual({
      tone: "brass",
      lead: "That is after",
      amount: 4210.5,
      tail: "owed on credit and loans.",
    });
  });

  it("is plain when nothing is owed", () => {
    expect(accountsVerdict({ count: 2, assets: 900, liabilities: 0 })).toMatchObject({
      tone: "jade",
      amount: null,
    });
  });

  it("treats a card in credit as nothing owed", () => {
    expect(accountsVerdict({ count: 2, assets: 900, liabilities: -25 })!.amount).toBeNull();
  });

  it("states the shortfall when debts exceed holdings", () => {
    const v = accountsVerdict({ count: 3, assets: 1000, liabilities: 3500 });
    expect(v).toMatchObject({ tone: "coral", lead: "You owe", tail: "more than you hold." });
    expect(v!.amount).toBeCloseTo(2500, 6);
  });
});
