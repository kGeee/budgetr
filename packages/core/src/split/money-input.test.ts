import { describe, expect, it } from "vitest";
import { acceptsMoneyDraft, formatMoneyDraft, parseMoneyDraft } from "./money-input.js";

describe("acceptsMoneyDraft — you must be able to type a decimal", () => {
  it("accepts every keystroke on the way to 6.36", () => {
    // The reported bug: the field refused decimals, because "6." parsed to 6 and
    // re-rendered as "6", eating the point the instant it was typed.
    for (const draft of ["", "6", "6.", "6.3", "6.36"]) {
      expect(acceptsMoneyDraft(draft), draft).toBe(true);
    }
  });

  it("accepts a leading point", () => {
    expect(acceptsMoneyDraft(".")).toBe(true);
    expect(acceptsMoneyDraft(".5")).toBe(true);
  });

  it("stops at two decimal places", () => {
    expect(acceptsMoneyDraft("6.36")).toBe(true);
    expect(acceptsMoneyDraft("6.365")).toBe(false);
  });

  it("refuses a second point", () => {
    expect(acceptsMoneyDraft("6.3.6")).toBe(false);
  });

  it("refuses letters and signs — a price is not an expression", () => {
    for (const junk of ["abc", "6a", "-6", "+6", "6e3", "$6"]) {
      expect(acceptsMoneyDraft(junk), junk).toBe(false);
    }
  });
});

describe("parseMoneyDraft", () => {
  it("reads a trailing point as the number so far", () => {
    expect(parseMoneyDraft("6.")).toBe(6);
  });

  it("returns null for states that are not a number yet", () => {
    expect(parseMoneyDraft("")).toBeNull();
    expect(parseMoneyDraft(".")).toBeNull();
    expect(parseMoneyDraft("   ")).toBeNull();
  });

  it("reads ordinary amounts", () => {
    expect(parseMoneyDraft("6.36")).toBe(6.36);
    expect(parseMoneyDraft("0")).toBe(0);
    expect(parseMoneyDraft(".5")).toBe(0.5);
  });
});

describe("formatMoneyDraft", () => {
  it("shows whole amounts without trailing zeros", () => {
    expect(formatMoneyDraft(48)).toBe("48");
  });

  it("shows cents when there are cents", () => {
    expect(formatMoneyDraft(6.36)).toBe("6.36");
    // Float noise from a tip preset must not reach the field.
    expect(formatMoneyDraft(13.860000000000001)).toBe("13.86");
  });

  it("shows nothing for an unset amount", () => {
    expect(formatMoneyDraft(null)).toBe("");
  });
});
