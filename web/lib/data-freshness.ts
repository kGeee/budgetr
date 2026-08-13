/**
 * How current the ledger is, and whether a reporting period can be honestly
 * reported at all.
 *
 * The app's arithmetic has never been the problem — the figures are right. What
 * was missing is provenance: nothing said that "August: $1,959.85 across 4
 * transactions" describes a sync that stopped on the 2nd rather than a quiet
 * month. Correct numbers presented without their age are worse than obviously
 * wrong ones, because you act on them.
 *
 * Two related questions live here:
 *
 *   - `getDataFreshness()` — how old is the data, and is a connection broken?
 *     Rendered as a banner on every page that reports a period figure.
 *   - `periodCoverage()` / `lastCompleteMonth()` — does the data reach the end
 *     of the window a page is about to report on? Review and Budgets use this
 *     to fall back to the last complete month instead of silently showing a
 *     partial one.
 *
 * Freshness is measured off the latest *settled* transaction date, not off
 * `items.updatedAt`. A sync attempt that returns nothing still stamps the item;
 * only a transaction actually landing proves the ledger moved. Connection state
 * comes from lib/connection-health, which keys off the same distinction.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  getConnectionSummary,
  type ConnectionSummary,
  type ConnectionHealth,
} from "@/lib/connection-health";

/**
 * Days without a new transaction before the ledger reads as stale. Named apart
 * from connection-health's STALE_AFTER_DAYS on purpose — that one is about a
 * single institution's last successful refresh, this one about the ledger as a
 * whole, and a component that shows both must not confuse them.
 */
export const LEDGER_STALE_AFTER_DAYS = 3;

export type FreshnessState =
  /** Everything reporting, data arrived recently. Say nothing. */
  | "current"
  /** No connection is broken, but nothing has landed lately. */
  | "stale"
  /** At least one institution is failing — some of the ledger is frozen. */
  | "broken";

export type DataFreshness = {
  state: FreshnessState;
  /** Latest settled transaction date as 'YYYY-MM-DD', or null on an empty ledger. */
  latestDate: string | null;
  /** Whole days since that date. Infinity when there are no transactions. */
  daysSinceLatest: number;
  /** The failing connection to name, when there is one. */
  broken: ConnectionHealth | null;
  connections: ConnectionSummary;
};

const DAY_MS = 86_400_000;

/** Whole days from an ISO date to `now`, floor'd. Negative dates read as 0. */
export function daysSince(isoDate: string, now: number): number {
  const then = Date.parse(`${isoDate}T00:00:00`);
  if (Number.isNaN(then)) return Infinity;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/**
 * Pure classification, so the state boundaries are testable without a database
 * — same split as classifyConnection.
 *
 * Broken outranks stale deliberately: a dead institution is a fact about the
 * data being *wrong*, while staleness only makes it late. A page that says
 * "nothing has synced in 8 days" when the real problem is that Chase has been
 * gone for seven weeks sends you to the wrong fix.
 */
export function classifyFreshness(
  latestDate: string | null,
  connections: ConnectionSummary,
  now = Date.now(),
): DataFreshness {
  const daysSinceLatest = latestDate === null ? Infinity : daysSince(latestDate, now);
  const broken = connections.all.find((c) => c.state === "error") ?? null;

  const state: FreshnessState = broken
    ? "broken"
    : daysSinceLatest >= LEDGER_STALE_AFTER_DAYS
      ? "stale"
      : "current";

  return { state, latestDate, daysSinceLatest, broken, connections };
}

/** The latest settled transaction date in the ledger, or null when empty. */
export function getLatestTransactionDate(): string | null {
  // Settled only, matching getBudgetMonth: a pending charge is a claim about
  // the future, not evidence that the sync is working.
  const row = db.get<{ d: string | null }>(
    sql`SELECT MAX(date) AS d FROM transactions WHERE pending = 0`,
  );
  return row?.d ?? null;
}

export function getDataFreshness(now = Date.now()): DataFreshness {
  return classifyFreshness(getLatestTransactionDate(), getConnectionSummary(now), now);
}

export type PeriodCoverage = {
  /** Does the data reach the end of the period? */
  complete: boolean;
  /** Last day of the period the data actually covers, or null if none of it. */
  coveredThrough: string | null;
  /** Days at the end of the period with nothing behind them. */
  missingDays: number;
};

/**
 * Whether a period can be reported honestly.
 *
 * The comparison is against the period's end *or today, whichever is sooner*.
 * That distinction is the whole point: the current month is trivially
 * "unfinished", and treating that as incomplete would push every page onto last
 * month forever. What matters is whether the ledger has caught up to the
 * present — a period running to Aug 31 with data through Aug 12 on Aug 12 is
 * fully covered so far, while the same period with data through Aug 2 on Aug 10
 * is missing eight days, and that gap is what made Review report a stalled sync
 * as a quiet month.
 *
 * All dates are 'YYYY-MM-DD', so lexical comparison is chronological.
 */
export function periodCoverage(
  start: string,
  end: string,
  latestDate: string | null,
  asOf: string = todayIso(),
): PeriodCoverage {
  // Nothing in the future can be missing yet.
  const effectiveEnd = end < asOf ? end : asOf;

  if (effectiveEnd < start) {
    // The period hasn't begun. Vacuously covered.
    return { complete: true, coveredThrough: null, missingDays: 0 };
  }
  if (latestDate === null || latestDate < start) {
    return {
      complete: false,
      coveredThrough: null,
      missingDays: daysBetweenIso(start, effectiveEnd) + 1,
    };
  }
  if (latestDate >= effectiveEnd) {
    return { complete: true, coveredThrough: latestDate, missingDays: 0 };
  }
  return {
    complete: false,
    coveredThrough: latestDate,
    missingDays: daysBetweenIso(latestDate, effectiveEnd),
  };
}

/** Today as 'YYYY-MM-DD' in local time — the ledger stores local dates. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** Whole days from one ISO date to another. Assumes `to >= from`. */
function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/**
 * The most recent calendar month the ledger covers in full, as 'YYYY-MM', or
 * null on an empty ledger.
 *
 * A month counts as complete once a transaction lands on or after its last day.
 * That is a slightly optimistic test — a bank could report the 31st and still
 * owe you the 29th — but it is the only signal available without knowing each
 * institution's posting lag, and it errs toward showing you a month rather than
 * hiding one you can see is finished.
 */
export function lastCompleteMonth(latestDate: string | null): string | null {
  if (latestDate === null) return null;
  const month = latestDate.slice(0, 7);
  const lastDayOfMonth = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);

  if (latestDate >= lastDayOfMonth) return month;

  // Latest data lands mid-month, so that month is partial — step back one.
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, "0")}`;
}
