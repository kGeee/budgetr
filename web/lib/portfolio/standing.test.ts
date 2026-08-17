import { describe, expect, it } from "vitest";
import { computeStanding, standingDetail, standingHeadline } from "./standing";
import type { ComparisonRow } from "@/lib/benchmark";

const row = (
  window: ComparisonRow["window"],
  portfolioPct: number | null,
  spyPct: number | null,
  qqqPct: number | null = spyPct,
): ComparisonRow => ({
  window,
  portfolioPct,
  spyPct,
  qqqPct,
  deltaVsSpy: portfolioPct != null && spyPct != null ? portfolioPct - spyPct : null,
  deltaVsQqq: portfolioPct != null && qqqPct != null ? portfolioPct - qqqPct : null,
});

/** The real account, as rendered on 15 Aug 2026. */
const REAL: ComparisonRow[] = [
  row("1M", 2.8, 3.4, 3.6),
  row("3M", -2.0, 5.0, 3.1),
  row("6M", 7.4, 13.9, 21.5),
  row("1Y", -5.0, 20.7, 26.6),
  row("YTD", 5.7, 13.8, 19.0),
];

describe("computeStanding — the real portfolio", () => {
  const s = computeStanding(REAL);

  it("leads with the year, not the flattering month", () => {
    expect(s.window).toBe("1Y");
    expect(s.returnPct).toBe(-5);
    expect(s.benchmarkPct).toBe(20.7);
  });

  it("states the gap in points, not percent", () => {
    expect(s.gapPoints).toBe(-25.7);
    expect(s.state).toBe("behind");
  });

  it("notices the portfolio trails in every window", () => {
    expect(s.behindEverywhere).toBe(true);
  });

  it("writes the sentence the page never said", () => {
    expect(standingHeadline(s)).toBe("Behind SPY by 25.7 points");
    expect(standingDetail(s)).toContain("You lost 5.0% over 1 year; SPY returned +20.7%");
    expect(standingDetail(s)).toContain("Behind in every window measured.");
  });

  it("can measure against QQQ instead", () => {
    const q = computeStanding(REAL, "QQQ");
    expect(q.benchmark).toBe("QQQ");
    expect(q.gapPoints).toBe(-31.6);
  });
});

describe("computeStanding — other shapes", () => {
  it("reports ahead when the portfolio beats the index", () => {
    const s = computeStanding([row("1Y", 24.5, 20.7)]);
    expect(s.state).toBe("ahead");
    expect(s.gapPoints).toBe(3.8);
    expect(standingHeadline(s)).toBe("Ahead of SPY by 3.8 points");
  });

  it("falls back down the window list when the year is missing", () => {
    expect(computeStanding([row("1M", 1, 2), row("3M", 3, 2)]).window).toBe("3M");
  });

  it("does not claim a spread from a single window", () => {
    expect(computeStanding([row("1Y", -5, 20.7)]).behindEverywhere).toBe(false);
  });

  it("says it cannot tell rather than inventing a comparison", () => {
    const s = computeStanding([]);
    expect(s.state).toBe("unknown");
    expect(s.gapPoints).toBeNull();
    expect(standingHeadline(s)).toMatch(/Not enough history/);
  });

  it("ignores windows with no benchmark price", () => {
    const s = computeStanding([row("1Y", -5, null), row("3M", 2, 1)]);
    expect(s.window).toBe("3M");
  });

  it("treats a dead heat as ahead rather than behind", () => {
    expect(computeStanding([row("1Y", 10, 10)]).state).toBe("ahead");
  });
});
