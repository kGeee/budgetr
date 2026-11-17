import { describe, expect, it } from "vitest";
import { forecastVerdict } from "./forecast-verdict";

describe("forecastVerdict", () => {
  it("states the fall when bills and pace outweigh income", () => {
    const v = forecastVerdict({ currentCash: 5000, projectedEndBalance: 3800, daysRemaining: 12 });
    expect(v).toMatchObject({ tone: "brass", lead: "Cash is set to fall by" });
    expect(v.amount).toBeCloseTo(1200, 6);
    expect(v.tail).toBe("by month-end, with 12 days left.");
  });

  it("states the growth when income outweighs what is still to clear", () => {
    const v = forecastVerdict({ currentCash: 2000, projectedEndBalance: 2650, daysRemaining: 1 });
    expect(v).toMatchObject({ tone: "jade", lead: "Cash is set to grow by" });
    expect(v.amount).toBeCloseTo(650, 6);
    expect(v.tail).toBe("by month-end, with 1 day left.");
  });

  it("warns when the month is projected to end overdrawn", () => {
    const v = forecastVerdict({ currentCash: 400, projectedEndBalance: -250, daysRemaining: 9 });
    expect(v).toMatchObject({ tone: "coral", amount: 250, tail: "overdrawn, with 9 days left." });
  });

  it("says cash holds when nothing is left to move it", () => {
    const v = forecastVerdict({ currentCash: 900, projectedEndBalance: 900, daysRemaining: 4 });
    expect(v).toMatchObject({ tone: "muted", lead: "Cash holds at", amount: 900 });
  });

  it("gives a result, not a projection, once the month has closed", () => {
    expect(
      forecastVerdict({ currentCash: 1500, projectedEndBalance: 1500, daysRemaining: 0 }),
    ).toMatchObject({ tone: "muted", lead: "The month closed with", amount: 1500, tail: "in cash." });
    expect(
      forecastVerdict({ currentCash: -80, projectedEndBalance: -80, daysRemaining: 0 }),
    ).toMatchObject({ tone: "coral", amount: 80, tail: "overdrawn." });
  });
});
