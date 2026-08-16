import Link from "next/link";
import { AlertTriangle, Clock, PlugZap } from "lucide-react";
import type { ConnectionHealth, ConnectionSummary } from "@/lib/connection-health";
import { describeAge } from "@/lib/connection-health";

/**
 * Connection health, shown three ways. All server components — none of this
 * needs state, and the chip renders inside list rows where an extra client
 * bundle per row is exactly the kind of cost the vendor page just paid for.
 */

const TONE = {
  live: {
    text: "text-[var(--jade)]",
    border: "border-[color-mix(in_srgb,var(--jade)_40%,transparent)]",
    bg: "bg-[color-mix(in_srgb,var(--jade)_10%,transparent)]",
  },
  stale: {
    text: "text-[var(--brass)]",
    border: "border-[var(--brass-dim)]",
    bg: "bg-[color-mix(in_srgb,var(--brass)_12%,transparent)]",
  },
  error: {
    text: "text-[var(--coral)]",
    border: "border-[color-mix(in_srgb,var(--coral)_45%,transparent)]",
    bg: "bg-[color-mix(in_srgb,var(--coral)_11%,transparent)]",
  },
} as const;

const LABEL = {
  live: (c: ConnectionHealth) => `Synced ${describeAge(c.daysSinceSuccess)}`,
  stale: (c: ConnectionHealth) => `Stale · ${describeAge(c.daysSinceSuccess)}`,
  error: () => "Disconnected",
} as const;

/** Inline state pill for an institution row. */
export function ConnectionChip({ health }: { health: ConnectionHealth }) {
  const tone = TONE[health.state];
  return (
    <span
      title={health.message}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone.border} ${tone.text}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABEL[health.state](health)}
    </span>
  );
}

/**
 * The banner for the worst connection problem, or null when everything is
 * healthy. Deliberately renders nothing rather than a reassuring "all good" —
 * a persistent green bar becomes invisible, and this needs to stay noticeable.
 */
export function ConnectionAlert({
  summary,
  className = "",
}: {
  summary: ConnectionSummary;
  className?: string;
}) {
  const worst = summary.worst;
  if (!worst) return null;

  const broken = worst.state === "error";
  const tone = TONE[worst.state];
  const Icon = broken ? PlugZap : Clock;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border px-4 py-3 text-sm ${tone.border} ${tone.bg} ${className}`}
    >
      <Icon size={15} className={`shrink-0 ${tone.text}`} />
      <p className="min-w-0 flex-1">
        <span className="font-medium">
          {broken
            ? `${worst.institutionName} is disconnected`
            : `Nothing has synced since ${describeAge(worst.daysSinceSuccess)}`}
        </span>
        <span className="text-[var(--muted)]">
          {" — "}
          {worst.message}
          {broken && worst.accountCount > 0 && (
            <>
              {" "}
              {worst.accountCount === 1 ? "Its balance is" : "Their balances are"} frozen at{" "}
              {worst.lastSuccessAt
                ? worst.lastSuccessAt.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                : "the last successful sync"}
              .
            </>
          )}
        </span>
      </p>
      <Link
        href="/settings#connections"
        className={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-[var(--panel-2)] ${tone.border} ${tone.text}`}
      >
        {broken ? "Reconnect" : "Review"}
      </Link>
    </div>
  );
}

/** Full per-institution list, for Settings. */
export function ConnectionList({ summary }: { summary: ConnectionSummary }) {
  if (summary.total === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No institutions linked yet. Use “Connect account” on the Accounts page.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-[var(--radius)] border border-line">
      {summary.all.map((c) => (
        <li key={c.itemId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-medium">
              {c.state === "error" && (
                <AlertTriangle size={13} className="shrink-0 text-[var(--coral)]" />
              )}
              {c.institutionName}
            </p>
            <p
              className={`mt-0.5 text-xs ${
                c.state === "error" ? "text-[var(--coral)]" : "text-[var(--muted)]"
              }`}
            >
              {c.accountCount} {c.accountCount === 1 ? "account" : "accounts"} · {c.message}
            </p>
          </div>
          <ConnectionChip health={c} />
        </li>
      ))}
    </ul>
  );
}
