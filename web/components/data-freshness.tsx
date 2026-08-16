import Link from "next/link";
import { CalendarClock, CircleAlert } from "lucide-react";
import { ConnectionAlert } from "@/components/connection-status";
import { describeAge } from "@/lib/connection-health";
import type { DataFreshness, PeriodCoverage } from "@/lib/data-freshness";

/**
 * The provenance layer: what a page says about its own data before it says
 * anything about your money.
 *
 * Deliberately renders nothing in the healthy case. A persistent "all data
 * current" bar is read once and then becomes furniture, and the whole point of
 * these banners is that they still register on the day something breaks.
 *
 * Server components — none of this holds state, and these sit at the top of
 * pages that are otherwise entirely server-rendered.
 */

/** Stale-ledger notice. The broken-connection case is ConnectionAlert's job. */
function StaleLedgerNotice({ freshness }: { freshness: DataFreshness }) {
  const { latestDate, daysSinceLatest } = freshness;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] px-4 py-3 text-sm">
      <CalendarClock size={15} className="shrink-0 text-[var(--brass)]" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">
          {latestDate === null
            ? "No transactions yet"
            : `Nothing new since ${formatDay(latestDate)}`}
        </span>
        <span className="text-[var(--muted)]">
          {" — "}
          {latestDate === null
            ? "nothing below is computed from real activity yet."
            : `${describeAge(daysSinceLatest)}. Figures below may be missing recent activity.`}
        </span>
      </p>
      <Link
        href="/settings#connections"
        className="shrink-0 rounded-md border border-[var(--brass-dim)] px-2.5 py-1 text-xs text-[var(--brass)] transition-colors hover:bg-[var(--panel-2)]"
      >
        Check connections
      </Link>
    </div>
  );
}

/**
 * Everything a page should say about its data before its figures.
 *
 * Ordered by severity — a broken institution above a stale ledger — because
 * they lead to different actions, and re-syncing will not fix a dead link.
 * `includeConnections` exists for Overview, which renders ConnectionAlert
 * itself; everywhere else this is the single call.
 */
export function DataFreshnessBanner({
  freshness,
  includeConnections = true,
  className = "",
}: {
  freshness: DataFreshness;
  includeConnections?: boolean;
  className?: string;
}) {
  const showConnection = includeConnections && freshness.connections.worst !== null;
  // Only the genuinely-stale state. When a link is broken the ledger can still
  // be current for every *other* institution, and pairing "Chase is
  // disconnected" with "nothing new since today" reads as a contradiction and
  // undercuts the banner that matters.
  const showStale = freshness.state === "stale";
  if (!showConnection && !showStale) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {showConnection && <ConnectionAlert summary={freshness.connections} />}
      {showStale && <StaleLedgerNotice freshness={freshness} />}
    </div>
  );
}

/**
 * Shown when a page has fallen back off the period you asked for.
 *
 * The failure this prevents: Review reporting "August: $1,959.85 across 4
 * transactions" with total confidence, when August has four transactions
 * because the sync stopped on the 2nd. Falling back silently would only move
 * the lie — the page has to say which period it is showing and why.
 */
export function IncompletePeriodNotice({
  requestedLabel,
  shownLabel,
  coverage,
  className = "",
}: {
  requestedLabel: string;
  /** The period actually rendered. Equal to `requestedLabel` when nothing was substituted. */
  shownLabel: string;
  coverage: PeriodCoverage;
  className?: string;
}) {
  const substituted = shownLabel !== requestedLabel;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] px-4 py-3 text-sm ${className}`}
    >
      <CircleAlert size={15} className="shrink-0 text-[var(--brass)]" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{requestedLabel} is incomplete</span>
        <span className="text-[var(--muted)]">
          {" — "}
          {coverage.coveredThrough
            ? `data stops at ${formatDay(coverage.coveredThrough)}, leaving ${coverage.missingDays} ${
                coverage.missingDays === 1 ? "day" : "days"
              } unaccounted for.`
            : "no transactions have landed in it."}
          {substituted
            ? ` Showing ${shownLabel}, the most recent complete period.`
            : " Treat the figures below as a partial month."}
        </span>
      </p>
    </div>
  );
}

/** "2026-08-02" → "Aug 2". Parsed as local time so it can't slip a day. */
function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
