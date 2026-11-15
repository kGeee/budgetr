import { describe, expect, it } from "vitest";
import { fireVerdict, goalsVerdict } from "./progress-verdict";

describe("fireVerdict", () => {
  it("says nothing without a FIRE number", () => {
    expect(fireVerdict({ netWorth: 100_000, fireNumber: 0 })).toBeNull();
  });

  it("states the gap and how far along it is", () => {
    const v = fireVerdict({ netWorth: 300_000, fireNumber: 1_200_000 });
    expect(v).toMatchObject({ tone: "brass", lead: "You are", amount: 900_000 });
    expect(v!.tail).toBe("short of financial independence, 25% of the way there.");
  });

  it("never rounds an unfinished climb up to 100%", () => {
    const v = fireVerdict({ netWorth: 999_000, fireNumber: 1_000_000 });
    expect(v!.tail).toContain("99% of the way");
  });

  it("floors a negative net worth at 0%", () => {
    const v = fireVerdict({ netWorth: -20_000, fireNumber: 1_000_000 });
    expect(v).toMatchObject({ amount: 1_020_000 });
    expect(v!.tail).toContain("0% of the way");
  });

  it("states the surplus once the number is reached", () => {
    expect(fireVerdict({ netWorth: 1_250_000, fireNumber: 1_000_000 })).toMatchObject({
      tone: "jade",
      amount: 250_000,
      tail: "past your FIRE number — congratulations.",
    });
  });
});

describe("goalsVerdict", () => {
  it("says nothing without a target", () => {
    expect(goalsVerdict({ totalSaved: 0, totalTarget: 0, count: 0 })).toBeNull();
  });

  it("states what is still missing across the goals", () => {
    const v = goalsVerdict({ totalSaved: 2_000, totalTarget: 8_000, count: 3 });
    expect(v).toMatchObject({ tone: "brass", amount: 6_000 });
    expect(v!.tail).toBe("short of fully funding 3 goals, 25% of the way there.");
  });

  it("uses the singular for one goal", () => {
    expect(goalsVerdict({ totalSaved: 10, totalTarget: 100, count: 1 })!.tail).toBe(
      "short of fully funding 1 goal, 10% of the way there.",
    );
    expect(goalsVerdict({ totalSaved: 100, totalTarget: 100, count: 1 })!.tail).toBe(
      "across 1 goal — the combined target is met.",
    );
  });

  // The totals can be met while one goal is still short, so the sentence
  // speaks of the combined target rather than claiming every goal is funded.
  it("reports the total set aside once the combined target is met", () => {
    expect(goalsVerdict({ totalSaved: 9_500, totalTarget: 9_000, count: 2 })).toMatchObject({
      tone: "jade",
      lead: "You have set aside",
      amount: 9_500,
      tail: "across 2 goals — the combined target is met.",
    });
  });
});
