import { describe, it, expect } from "vitest";
import {
  LEDGER_STALE_AFTER_DAYS,
  classifyFreshness,
  daysSince,
  lastCompleteMonth,
  periodCoverage,
  todayIso,
} from "@/lib/data-freshness";
import type { ConnectionHealth, ConnectionSummary } from "@/lib/connection-health";

// Everything here is pure. The two DB readers on top of it (the MAX(date) query
// and getConnectionSummary) are exercised by the pages.

const NOW = Date.parse("2026-08-10T12:00:00");

const conn = (state: ConnectionHealth["state"], name = "Chase"): ConnectionHealth => ({
  itemId: `item_${name}`,
  institutionName: name,
  state,
  errorCode: state === "error" ? "NO_ACCOUNTS" : null,
  message: "…",
  lastSuccessAt: new Date(NOW),
  daysSinceSuccess: 0,
  accountCount: 1,
});

const summary = (...all: ConnectionHealth[]): ConnectionSummary => ({
  all,
  worst: all.find((c) => c.state !== "live") ?? null,
  liveCount: all.filter((c) => c.state === "live").length,
  total: all.length,
  daysSinceAnySync: 0,
});

describe("classifyFreshness", () => {
  it("says nothing when data is recent and every link is live", () => {
    const f = classifyFreshness("2026-08-09", summary(conn("live", "BofA")), NOW);
    expect(f.state).toBe("current");
    expect(f.broken).toBeNull();
  });

  it("turns stale exactly at the threshold, not a day later", () => {
    const at = `2026-08-${String(10 - LEDGER_STALE_AFTER_DAYS).padStart(2, "0")}`;
    expect(classifyFreshness(at, summary(conn("live")), NOW).state).toBe("stale");
    const inside = `2026-08-${String(11 - LEDGER_STALE_AFTER_DAYS).padStart(2, "0")}`;
    expect(classifyFreshness(inside, summary(conn("live")), NOW).state).toBe("current");
  });

  it("reports a broken link ahead of staleness, and names it", () => {
    // The failure mode this exists to prevent: telling someone to re-sync when
    // the real problem is an institution that has been dead for seven weeks.
    const f = classifyFreshness("2026-08-09", summary(conn("live", "BofA"), conn("error")), NOW);
    expect(f.state).toBe("broken");
    expect(f.broken?.institutionName).toBe("Chase");
  });

  it("treats an empty ledger as stale rather than current", () => {
    const f = classifyFreshness(null, summary(conn("live")), NOW);
    expect(f.state).toBe("stale");
    expect(f.daysSinceLatest).toBe(Infinity);
  });
});

describe("daysSince", () => {
  it("counts whole days and never goes negative", () => {
    expect(daysSince("2026-08-10", NOW)).toBe(0);
    expect(daysSince("2026-08-02", NOW)).toBe(8);
    expect(daysSince("2026-08-20", NOW)).toBe(0);
  });
});

describe("periodCoverage", () => {
  const AUG = { start: "2026-08-01", end: "2026-08-31" };
  const TODAY = "2026-08-10";

  it("is incomplete when the ledger has fallen behind today", () => {
    const c = periodCoverage(AUG.start, AUG.end, "2026-08-02", TODAY);
    expect(c.complete).toBe(false);
    expect(c.coveredThrough).toBe("2026-08-02");
    expect(c.missingDays).toBe(8);
  });

  it("does NOT treat an unfinished current month as incomplete", () => {
    // The regression this pins: measuring against Aug 31 rather than today
    // makes the current month permanently "incomplete", which would push
    // Review and Budgets onto last month every day of the year.
    const c = periodCoverage(AUG.start, AUG.end, TODAY, TODAY);
    expect(c.complete).toBe(true);
    expect(c.missingDays).toBe(0);
  });

  it("is complete once data reaches a closed period's final day", () => {
    expect(periodCoverage("2026-07-01", "2026-07-31", "2026-08-02", TODAY).complete).toBe(true);
    expect(periodCoverage("2026-07-01", "2026-07-31", "2026-07-31", TODAY).complete).toBe(true);
  });

  it("is incomplete when a closed period was never fully synced", () => {
    const c = periodCoverage("2026-07-01", "2026-07-31", "2026-07-20", TODAY);
    expect(c.complete).toBe(false);
    expect(c.missingDays).toBe(11);
  });

  it("is incomplete — not complete-with-zero — when nothing lands in the period at all", () => {
    const c = periodCoverage(AUG.start, AUG.end, "2026-07-15", TODAY);
    expect(c.complete).toBe(false);
    expect(c.coveredThrough).toBeNull();
    expect(c.missingDays).toBe(10);
  });

  it("treats a period that hasn't started as vacuously covered", () => {
    expect(periodCoverage("2026-09-01", "2026-09-30", "2026-08-10", TODAY).complete).toBe(true);
  });

  it("handles an empty ledger", () => {
    expect(periodCoverage(AUG.start, AUG.end, null, TODAY).complete).toBe(false);
  });
});

describe("todayIso", () => {
  it("uses local calendar fields, not UTC", () => {
    // A late-evening local time is already tomorrow in UTC; toISOString would
    // report the wrong day and make the ledger look a day behind every night.
    expect(todayIso(new Date(2026, 7, 10, 23, 30))).toBe("2026-08-10");
    expect(todayIso(new Date(2026, 0, 5, 0, 15))).toBe("2026-01-05");
  });
});

describe("lastCompleteMonth", () => {
  it("steps back when the latest data is mid-month", () => {
    expect(lastCompleteMonth("2026-08-02")).toBe("2026-07");
  });

  it("keeps the month once its final day has landed", () => {
    expect(lastCompleteMonth("2026-07-31")).toBe("2026-07");
  });

  it("crosses a year boundary", () => {
    expect(lastCompleteMonth("2026-01-09")).toBe("2025-12");
  });

  it("knows February's length", () => {
    expect(lastCompleteMonth("2026-02-28")).toBe("2026-02");
    expect(lastCompleteMonth("2026-02-27")).toBe("2026-01");
    // 2028 is a leap year: the 28th is no longer the end of the month.
    expect(lastCompleteMonth("2028-02-28")).toBe("2028-01");
    expect(lastCompleteMonth("2028-02-29")).toBe("2028-02");
  });

  it("returns null on an empty ledger", () => {
    expect(lastCompleteMonth(null)).toBeNull();
  });
});
