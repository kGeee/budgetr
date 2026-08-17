/**
 * "How am I actually doing?" — reduced to one sentence.
 *
 * The Portfolio desk computed this on every page load and then rendered it as
 * row four of an unlabelled five-row table two screens down. On the account this
 * was written against, that buried row said the portfolio returned −5.0% over a
 * year while SPY returned +20.7%: the single most consequential fact on the
 * page, in 11px type, below a headline market value that goes up whenever you
 * deposit money.
 *
 * This picks the window to lead with and states the comparison in percentage
 * *points* — the delta between two percentages is not itself a percentage, and
 * writing "−25.7%" for it reads as a loss rather than a gap.
 */

import type { ComparisonRow } from "@/lib/benchmark";

export type StandingState = "ahead" | "behind" | "unknown";

export type Standing = {
  state: StandingState;
  /** The window being led with, e.g. "1Y". */
  window: ComparisonRow["window"] | null;
  /** Human label for that window. */
  windowLabel: string;
  /** The portfolio's time-weighted return over that window, percent. */
  returnPct: number | null;
  /** The benchmark's return over the same window, percent. */
  benchmarkPct: number | null;
  /** returnPct − benchmarkPct, in points. Positive = ahead. */
  gapPoints: number | null;
  /** Which benchmark the gap is measured against. */
  benchmark: "SPY" | "QQQ";
  /** True when the portfolio trails the benchmark in every window we have. */
  behindEverywhere: boolean;
  /** Why we can't say anything, when state is "unknown". */
  reason: string | null;
};

export const WINDOW_LABEL: Record<ComparisonRow["window"], string> = {
  "1M": "1 month",
  "3M": "3 months",
  "6M": "6 months",
  "1Y": "1 year",
  YTD: "Year to date",
};

/**
 * Prefer the longest window that has data. A year of history says more about
 * how you're investing than a month does, and the month is the one most likely
 * to be noise — leading with it would flatter or panic for no reason.
 */
const PREFERENCE: ComparisonRow["window"][] = ["1Y", "YTD", "6M", "3M", "1M"];

export function computeStanding(
  comparison: ComparisonRow[],
  benchmark: "SPY" | "QQQ" = "SPY",
): Standing {
  const usable = comparison.filter((r) => r.portfolioPct != null && pick(r, benchmark) != null);

  if (usable.length === 0) {
    return {
      state: "unknown",
      window: null,
      windowLabel: "",
      returnPct: null,
      benchmarkPct: null,
      gapPoints: null,
      benchmark,
      behindEverywhere: false,
      reason:
        comparison.length === 0
          ? "Not enough history yet to compare against the market."
          : "Waiting on benchmark prices.",
    };
  }

  const lead =
    PREFERENCE.map((w) => usable.find((r) => r.window === w)).find(Boolean) ?? usable[0];

  const benchmarkPct = pick(lead, benchmark)!;
  const returnPct = lead.portfolioPct!;
  const gapPoints = round1(returnPct - benchmarkPct);

  return {
    state: gapPoints >= 0 ? "ahead" : "behind",
    window: lead.window,
    windowLabel: WINDOW_LABEL[lead.window],
    returnPct,
    benchmarkPct,
    gapPoints,
    benchmark,
    behindEverywhere:
      usable.length > 1 && usable.every((r) => r.portfolioPct! - pick(r, benchmark)! < 0),
    reason: null,
  };
}

function pick(row: ComparisonRow, benchmark: "SPY" | "QQQ"): number | null {
  return benchmark === "SPY" ? row.spyPct : row.qqqPct;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "Behind the market by 25.7 points" — the sentence, ready to render. */
export function standingHeadline(s: Standing): string {
  if (s.state === "unknown") return s.reason ?? "Not enough history to compare.";
  const magnitude = `${Math.abs(s.gapPoints!).toFixed(1)} points`;
  return s.state === "ahead"
    ? `Ahead of ${s.benchmark} by ${magnitude}`
    : `Behind ${s.benchmark} by ${magnitude}`;
}

/** The supporting clause: what each side actually returned. */
export function standingDetail(s: Standing): string {
  if (s.state === "unknown") return "";
  const you = signed(s.returnPct!);
  const them = signed(s.benchmarkPct!);
  const spread = s.behindEverywhere ? " Behind in every window measured." : "";
  return `You ${you} over ${s.windowLabel.toLowerCase()}; ${s.benchmark} ${them}. Deposits excluded.${spread}`;
}

const signed = (n: number) => `${n >= 0 ? "returned +" : "lost "}${Math.abs(n).toFixed(1)}%`;
