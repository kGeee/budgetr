import { describe, it, expect } from "vitest";
import { stepDate, streamOccurrences } from "@/lib/recurrence";

describe("stepDate", () => {
  it("advances by the right cadence", () => {
    const d = new Date("2026-07-02T00:00:00");
    expect(stepDate(d, "WEEKLY")?.toISOString().slice(0, 10)).toBe("2026-07-09");
    expect(stepDate(d, "BIWEEKLY")?.toISOString().slice(0, 10)).toBe("2026-07-16");
    expect(stepDate(d, "MONTHLY")?.toISOString().slice(0, 10)).toBe("2026-08-02");
    expect(stepDate(d, "ANNUALLY")?.toISOString().slice(0, 10)).toBe("2027-07-02");
  });

  it("is case-insensitive and returns null for non-repeating frequencies", () => {
    expect(stepDate(new Date("2026-07-02T00:00:00"), "weekly")).not.toBeNull();
    expect(stepDate(new Date("2026-07-02T00:00:00"), "UNKNOWN")).toBeNull();
    expect(stepDate(new Date("2026-07-02T00:00:00"), null)).toBeNull();
  });
});

describe("streamOccurrences", () => {
  // The bug this fixed: a biweekly paycheck whose stored prediction (Jul 2) has
  // already passed must still project forward onto Jul 16 & Jul 30 — not vanish.
  it("rolls a stale biweekly anchor forward, emitting every occurrence in-window", () => {
    expect(streamOccurrences("2026-07-02", "BIWEEKLY", "2026-07-04", "2026-07-31")).toEqual([
      "2026-07-16",
      "2026-07-30",
    ]);
  });

  it("emits weekly occurrences across the window", () => {
    expect(streamOccurrences("2026-07-01", "WEEKLY", "2026-07-01", "2026-07-29")).toEqual([
      "2026-07-01",
      "2026-07-08",
      "2026-07-15",
      "2026-07-22",
      "2026-07-29",
    ]);
  });

  it("rolls a monthly anchor forward one period", () => {
    expect(streamOccurrences("2026-06-30", "MONTHLY", "2026-07-04", "2026-07-31")).toEqual([
      "2026-07-30",
    ]);
  });

  it("treats non-repeating streams as a single dated event", () => {
    expect(streamOccurrences("2026-07-10", "UNKNOWN", "2026-07-01", "2026-07-31")).toEqual([
      "2026-07-10",
    ]);
    // …and omits it when the single date falls outside the window.
    expect(streamOccurrences("2026-08-10", "UNKNOWN", "2026-07-01", "2026-07-31")).toEqual([]);
  });

  it("returns nothing for an empty/inverted window", () => {
    expect(streamOccurrences("2026-07-16", "BIWEEKLY", "2026-07-31", "2026-07-01")).toEqual([]);
  });

  it("includes a future in-window anchor as the first occurrence", () => {
    expect(streamOccurrences("2026-07-10", "BIWEEKLY", "2026-07-01", "2026-07-31")).toEqual([
      "2026-07-10",
      "2026-07-24",
    ]);
  });
});
