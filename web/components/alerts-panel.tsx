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
  type LucideIcon,
} from "lucide-react";
import { dismissAlert, snoozeAlert } from "@/lib/actions-alerts";
import { ReviewInbox } from "@/components/transactions/review-inbox";
import { formatCurrency } from "@/lib/utils";
import type { Alert, AlertKind } from "@/lib/anomalies";
import type { CategoryRow, TransactionRow } from "@/lib/queries";

const ICONS: Record<AlertKind, LucideIcon> = {
  spike: AlertTriangle,
  duplicate: CopyMinus,
  creep: TrendingUp,
  trial: Timer,
  health: PlugZap,
};

// Per-kind accent — coral for money-at-risk (spike/duplicate) and for data the
// app can't stand behind (health), brass for heads-up (creep/trial). Colours
// the row's icon and its amount.
const ACCENT: Record<AlertKind, string> = {
  spike: "text-[var(--coral)]",
  duplicate: "text-[var(--coral)]",
  creep: "text-[var(--brass)]",
  trial: "text-[var(--brass)]",
  health: "text-[var(--coral)]",
};

const KIND_LABEL: Record<AlertKind, string> = {
  spike: "Spending spike",
  duplicate: "Duplicate charge",
  creep: "Price creep",
  trial: "Trial ending",
  health: "Data health",
};

const HEAD_LINK = "text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)]";
const PILL =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm transition active:scale-[0.98] disabled:opacity-50";
const PILL_PRIMARY = `${PILL} bg-[var(--jade)] font-semibold text-[var(--on-jade)] hover:brightness-105`;
const PILL_STRONG = `${PILL} border border-[var(--line-strong)] text-[var(--paper)] hover:bg-[var(--panel-2)]`;
const PILL_QUIET = `${PILL} border border-line text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]`;

function snoozeDate(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

/**
 * Home's "Needs you": data-health and spending alerts, then the first few
 * transactions waiting for review, each a ruled row with its actions beside it.
 * With `limit` it shows the first few alerts and expands in place — there's no
 * separate insights page to send you to any more.
 */
export function AlertsPanel({
  alerts,
  compact = false,
  limit,
  reviewCount = 0,
  review = [],
  categories = [],
}: {
  alerts: Alert[];
  compact?: boolean;
  limit?: number;
  /** Unreviewed settled transactions — the whole backlog, not just `review`. */
  reviewCount?: number;
  /** The first few of that backlog, listed here with their one-click actions. */
  review?: TransactionRow[];
  /** Backs the detail panel a review row opens. */
  categories?: CategoryRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const capped = typeof limit === "number" && !expanded;
  const shown = capped ? alerts.slice(0, limit) : alerts;
  const hidden = alerts.length - shown.length;
  const things = alerts.length + reviewCount;
  const moreReview = reviewCount - review.length;

  if (things === 0) {
    return (
      <section aria-label="Needs you">
        <SectionHead title="Needs you" />
        {/* A clear board is a claim about what was checked, not an absence of
            output — so it names the checks. Saying only "nothing unusual" is
            what let a seven-week-dead connection sit behind a reassuring green
            tick. */}
        <p className="border-b border-line py-3.5 text-sm">
          <span className="font-medium text-[var(--jade)]">Nothing needs you.</span>{" "}
          <span className="text-[var(--muted)]">
            Every connection is reporting, your ledger is current, every transaction is reviewed,
            and no spending spikes, duplicate charges or subscription surprises turned up.
          </span>
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Needs you">
      <SectionHead
        title="Needs you"
        count={things.toLocaleString()}
        action={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {typeof limit === "number" && alerts.length > limit && (
              <button onClick={() => setExpanded((e) => !e)} className={HEAD_LINK}>
                {expanded ? "Show fewer alerts" : `All ${alerts.length} alerts`}
              </button>
            )}
            {reviewCount > 0 && (
              <Link href="/transactions?view=review" className={HEAD_LINK}>
                Open review
              </Link>
            )}
          </span>
        }
      />

      {shown.map((a) => (
        <AlertRow key={a.key} alert={a} compact={compact} />
      ))}

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="block w-full border-b border-line py-3 text-left text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
        >
          {hidden} more {hidden === 1 ? "alert" : "alerts"}
        </button>
      )}

      {review.length > 0 && (
        <ReviewInbox bare transactions={review} categories={categories} total={reviewCount} />
      )}

      {moreReview > 0 && (
        <Link
          href="/transactions?view=review"
          className="flex items-center justify-between gap-3 border-b border-line py-3 text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
        >
          <span>
            {review.length > 0
              ? `${moreReview.toLocaleString()} more to review`
              : `${moreReview.toLocaleString()} ${moreReview === 1 ? "transaction" : "transactions"} to review`}
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
    </section>
  );
}

function AlertRow({ alert, compact }: { alert: Alert; compact: boolean }) {
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
      className={`flex flex-wrap items-center gap-3 border-b border-line py-3 ${pending ? "opacity-50" : ""}`}
    >
      <div className="min-w-0 flex-[1_1_280px]">
        <p className="text-sm font-medium text-[var(--paper)]">
          <Icon size={14} className={`mr-2 inline-block align-[-2px] ${accent}`} aria-hidden />
          {alert.title}
          {typeof alert.amount === "number" && !compact && (
            <span className={`mono ml-2 font-normal ${accent}`}>
              {formatCurrency(alert.amount)}
            </span>
          )}
        </p>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          {KIND_LABEL[alert.kind]}
          {alert.date && <span className="mono text-xs"> · {alert.date}</span>}
          {" · "}
          {alert.detail}
        </p>
      </div>

      {/* Health alerts carry an action instead of a dismissal. Letting someone
          permanently hide "Chase is disconnected" would reintroduce exactly the
          silence these alerts exist to break — and dismissal is keyed through
          detectAnomalies, which never sees them anyway, so the button would
          appear to work and then undo itself on refresh. */}
      {alert.kind === "health" ? (
        alert.action && (
          <Link href={alert.action.href} className={PILL_PRIMARY}>
            {alert.action.label}
          </Link>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {showSnooze ? (
            <>
              <span className="text-[13px] text-[var(--muted)]">Snooze for</span>
              {[7, 30, 90].map((d) => (
                <button key={d} disabled={pending} onClick={() => snooze(d)} className={PILL_STRONG}>
                  {d}d
                </button>
              ))}
              <button
                disabled={pending}
                onClick={() => setShowSnooze(false)}
                className={PILL_QUIET}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button disabled={pending} onClick={dismiss} className={PILL_STRONG}>
                <X size={14} /> Dismiss
              </button>
              <button
                disabled={pending}
                onClick={() => setShowSnooze(true)}
                className={PILL_QUIET}
              >
                <Clock size={14} /> Snooze
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
