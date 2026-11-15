import { describe, expect, it } from "vitest";
import { ledgerVerdict, reviewVerdict } from "./transactions-verdict";

describe("ledgerVerdict", () => {
  const base = { total: 10, filtered: false };

  it("distinguishes an empty ledger from an empty filter", () => {
    expect(ledgerVerdict({ total: 0, spent: 0, received: 0, filtered: false }).lead).toBe(
      "No transactions yet.",
    );
    expect(ledgerVerdict({ total: 0, spent: 0, received: 0, filtered: true }).lead).toBe(
      "Nothing matches these filters.",
    );
  });

  it("reports the surplus when more came in than went out", () => {
    const v = ledgerVerdict({ ...base, spent: 1200, received: 2000 });
    expect(v).toMatchObject({ tone: "jade", lead: "That is", tail: "less than came in." });
    expect(v.amount).toBeCloseTo(800, 6);
  });

  it("reports the shortfall when more went out than came in", () => {
    const v = ledgerVerdict({ ...base, spent: 2000, received: 1250.5 });
    expect(v).toMatchObject({ tone: "brass", tail: "more than came in." });
    expect(v.amount).toBeCloseTo(749.5, 6);
  });

  it("has no figure when nothing came in", () => {
    expect(ledgerVerdict({ ...base, spent: 40, received: 0 })).toEqual({
      tone: "muted",
      lead: "Nothing came in against it.",
      amount: null,
      tail: "",
    });
  });

  it("leads with income when nothing went out", () => {
    expect(ledgerVerdict({ ...base, spent: 0, received: 300 })).toMatchObject({
      tone: "jade",
      lead: "Nothing went out, and",
      amount: 300,
      tail: "came in.",
    });
  });

  it("says so when the matches are all transfers", () => {
    expect(ledgerVerdict({ ...base, spent: 0, received: 0 }).lead).toBe(
      "Nothing here counts as spending or income.",
    );
  });

  it("calls a sub-cent difference level", () => {
    const v = ledgerVerdict({ ...base, spent: 100, received: 100.004 });
    expect(v.amount).toBeNull();
    expect(v.lead).toBe("Money in and money out are level.");
  });
});

describe("reviewVerdict", () => {
  it("celebrates an empty backlog", () => {
    expect(reviewVerdict({ total: 0, loaded: 0, out: 0, in: 0 })).toMatchObject({
      tone: "jade",
      amount: null,
    });
  });

  it("sums the whole backlog when it is all loaded", () => {
    expect(reviewVerdict({ total: 12, loaded: 12, out: 410.25, in: 90 })).toEqual({
      tone: "brass",
      lead: "Together they carry",
      amount: 410.25,
      tail: "of unconfirmed spending.",
    });
  });

  it("never lets a loaded page stand in for the whole backlog", () => {
    const v = reviewVerdict({ total: 1340, loaded: 100, out: 50, in: 0 });
    expect(v.lead).toBe("The 100 most recent carry");
  });

  it("uses the singular for one entry", () => {
    expect(reviewVerdict({ total: 1, loaded: 1, out: 9, in: 0 }).lead).toBe("It carries");
    expect(reviewVerdict({ total: 1, loaded: 1, out: 0, in: 0 }).lead).toBe("It moves no money.");
  });

  it("falls back to income when nothing in the queue is spending", () => {
    expect(reviewVerdict({ total: 3, loaded: 3, out: 0, in: 2500 })).toMatchObject({
      tone: "jade",
      amount: 2500,
      tail: "of unconfirmed income.",
    });
  });
});
