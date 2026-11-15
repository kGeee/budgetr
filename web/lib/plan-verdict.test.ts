import { describe, expect, it } from "vitest";
import { cadenceLabel, commitmentLead, daysUntil, dueIn, yearsFigure } from "./plan-verdict";

describe("commitmentLead", () => {
  const rows = [
    { id: "rent", frequency: "MONTHLY", averageAmount: -900 },
    { id: "insurance", frequency: "ANNUALLY", averageAmount: -1200 },
    { id: "odd", frequency: "UNKNOWN", averageAmount: -5000 },
  ];

  it("ranks by monthly equivalent, not by raw amount", () => {
    // Yearly 1200 is 100 a month; the irregular 5000 has no monthly figure.
    const lead = commitmentLead(rows, 1000);
    expect(lead?.row.id).toBe("rent");
    expect(lead?.monthly).toBeCloseTo(900, 6);
    expect(lead?.share).toBeCloseTo(0.9, 6);
  });

  it("is null without a total or without normalisable streams", () => {
    expect(commitmentLead(rows, 0)).toBeNull();
    expect(commitmentLead([rows[2]], 100)).toBeNull();
  });

  it("never reports more than the whole", () => {
    expect(commitmentLead([rows[0]], 500)?.share).toBe(1);
  });
});

describe("daysUntil / dueIn", () => {
  it("counts whole days either side of today", () => {
    expect(daysUntil("2026-07-18", "2026-07-15")).toBe(3);
    expect(daysUntil("2026-07-10", "2026-07-15")).toBe(-5);
    expect(daysUntil("nope", "2026-07-15")).toBeNull();
  });

  it("words the distance", () => {
    expect(dueIn("2026-07-15", "2026-07-15")).toBe("due today");
    expect(dueIn("2026-07-16", "2026-07-15")).toBe("due tomorrow");
    expect(dueIn("2026-07-22", "2026-07-15")).toBe("due in 7 days");
  });

  it("says nothing for a past or missing date", () => {
    expect(dueIn("2026-07-10", "2026-07-15")).toBe("");
    expect(dueIn(null, "2026-07-15")).toBe("");
  });
});

describe("yearsFigure", () => {
  it("keeps one decimal", () => {
    expect(yearsFigure(15.58)).toBe("15.6");
    expect(yearsFigure(2)).toBe("2.0");
  });
});

describe("cadenceLabel", () => {
  it("names known frequencies and falls back for the rest", () => {
    expect(cadenceLabel("BIWEEKLY")).toBe("Every 2 weeks");
    expect(cadenceLabel("UNKNOWN")).toBe("Irregular");
    expect(cadenceLabel(null)).toBe("Recurring");
    expect(cadenceLabel("QUARTERLY")).toBe("Recurring");
  });
});
