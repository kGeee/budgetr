"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SectionHead } from "@/components/ui/statement";
import {
  AlertTriangle,
  CopyMinus,
  TrendingUp,
  Timer,
  X,
  Clock,
  PlugZap,
  ShieldCheck,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { dismissAlert, snoozeAlert } from "@/lib/actions-alerts";
import { formatCurrency } from "@/lib/utils";
import type { Alert, AlertKind } from "@/lib/anomalies";

const ICONS: Record<AlertKind, LucideIcon> = {
  spike: AlertTriangle,
  duplicate: CopyMinus,
  creep: TrendingUp,
  trial: Timer,
  health: PlugZap,
};

// Per-kind accent — coral for money-at-risk (spike/duplicate) and for data the
// app can't stand behind (health), brass for heads-up (creep/trial). Drives
// icon chip + left rail colour.
const ACCENT: Record<AlertKind, string> = {
  spike: "var(--coral)",
  duplicate: "var(--coral)",
  creep: "var(--brass)",
  trial: "var(--brass)",
  health: "var(--coral)",
};

const KIND_LABEL: Record<AlertKind, string> = {
  spike: "Spending spike",
  duplicate: "Duplicate charge",
  creep: "Price creep",
  trial: "Trial ending",
  health: "Data health",
};

function snoozeDate(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

/**
 * Home's "Needs attention" card: data-health and spending alerts, plus the
 * review backlog as one line into Transactions → Needs review. With `limit` it
 * shows the first few and expands in place — there's no separate insights page
 * to send you to any more.
 */
export function AlertsPanel({
  alerts,
  compact = false,
  limit,
  reviewCount = 0,
}: {
  alerts: Alert[];
  compact?: boolean;
  limit?: number;
  /** Unreviewed settled transactions; renders the review line when > 0. */
  reviewCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const capped = typeof limit === "number" && !expanded;
  const shown = capped ? alerts.slice(0, limit) : alerts;
  const hidden = alerts.length - shown.length;
  const things = alerts.length + (reviewCount > 0 ? 1 : 0);

  if (things === 0) {
    return (
      <div className="border-y border-line py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--jade)_35%,transparent)] text-[var(--jade)]">
            <ShieldCheck size={16} />
          </span>
          <div>
            {/* A clear board is a claim about what was checked, not an absence
                of output — so it names the checks. Saying only "nothing
                unusual" is what let a seven-week-dead connection sit behind a
                reassuring green tick. */}
            <p className="text-sm font-medium text-[var(--paper)]">Nothing needs you</p>
            <p className="text-xs text-[var(--muted)]">
              Every connection is reporting, your ledger is current, every transaction is
              reviewed, and no spending spikes, duplicate charges or subscription surprises
              turned up.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <SectionHead
        title="Needs attention"
        count={`${things} ${things === 1 ? "thing" : "things"} worth a look`}
        action={
          typeof limit === "number" &&
          alerts.length > limit && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-[var(--brass)] hover:underline"
            >
              {expanded ? "Show fewer" : `See all ${alerts.length}`}
            </button>
          )
        }
      />

      {reviewCount > 0 && (
        <Link
          href="/transactions?view=review"
          className="flex items-center gap-3 rounded-lg border border-line bg-[var(--panel-2)] px-4 py-3 text-sm transition-colors hover:border-[var(--line-strong)]"
        >
          <ListChecks size={16} className="shrink-0 text-[var(--brass)]" />
          <span className="flex-1 text-[var(--paper)]">
            {reviewCount.toLocaleString()} {reviewCount === 1 ? "transaction" : "transactions"}{" "}
            to review
          </span>
          <span className="text-[var(--brass)]">→</span>
        </Link>
      )}

      {shown.length > 0 && (
        <div className="space-y-3">
          {shown.map((a) => (
            <AlertCard key={a.key} alert={a} compact={compact} />
          ))}
        </div>
      )}

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="block w-full text-center text-xs text-[var(--muted)] hover:text-[var(--paper)]"
        >
          +{hidden} more
        </button>
      )}
    </section>
  );
}

function AlertCard({ alert, compact }: { alert: Alert; compact: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showSnooze, setShowSnooze] = useState(false);
  const Icon = ICONS[alert.kind];
  const accent = ACCENT[alert.kind];

  function dismiss() {
    start(async () => {
      await dismissAlert(alert.key);
      router.refresh();
    });
  }

  function snooze(days: number) {
    start(async () => {
      await snoozeAlert(alert.key, snoozeDate(days));
      router.refresh();
    });
  }

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line bg-[var(--panel-2)] p-4 pl-5"
      style={{ opacity: pending ? 0.5 : 1 }}
    >
      <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: accent }} />
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border"
          style={{
            color: accent,
            borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`,
            background: `color-mix(in srgb, ${accent} 8%, transparent)`,
          }}
        >
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className="eyebrow"
              style={{ color: `color-mix(in srgb, ${accent} 80%, var(--paper))` }}
            >
              {KIND_LABEL[alert.kind]}
            </p>
            {alert.date && (
              <span className="mono text-[10px] text-[var(--muted)]">{alert.date}</span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-[var(--paper)]">{alert.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{alert.detail}</p>

          {typeof alert.amount === "number" && !compact && (
            <p className="mono mt-2 text-sm" style={{ color: accent }}>
              {formatCurrency(alert.amount)}
            </p>
          )}

          {/* Health alerts carry an action instead of a dismissal. Letting
              someone permanently hide "Chase is disconnected" would reintroduce
              exactly the silence these alerts exist to break — and dismissal is
              keyed through detectAnomalies, which never sees them anyway, so the
              button would appear to work and then undo itself on refresh. */}
          {alert.kind === "health" ? (
            alert.action && (
              <div className="mt-3">
                <Link
                  href={alert.action.href}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--panel)] px-3 py-1 text-xs font-medium text-[var(--paper)] transition hover:border-[var(--line-strong)]"
                >
                  {alert.action.label} →
                </Link>
              </div>
            )
          ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {showSnooze ? (
              <>
                <span className="text-xs text-[var(--muted)]">Snooze for</span>
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    disabled={pending}
                    onClick={() => snooze(d)}
                    className="rounded-full border border-line bg-[var(--panel)] px-2.5 py-1 text-xs text-[var(--paper)] transition hover:border-[var(--line-strong)] active:scale-[0.98]"
                  >
                    {d}d
                  </button>
                ))}
                <button
                  disabled={pending}
                  onClick={() => setShowSnooze(false)}
                  className="text-xs text-[var(--muted)] hover:text-[var(--paper)]"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={pending}
                  onClick={dismiss}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--panel)] px-3 py-1 text-xs font-medium text-[var(--paper)] transition hover:border-[var(--line-strong)] active:scale-[0.98]"
                >
                  <X size={12} /> Dismiss
                </button>
                <button
                  disabled={pending}
                  onClick={() => setShowSnooze(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--panel)] px-3 py-1 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--paper)] active:scale-[0.98]"
                >
                  <Clock size={12} /> Snooze
                </button>
              </>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
