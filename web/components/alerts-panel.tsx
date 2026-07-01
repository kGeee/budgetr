"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CopyMinus,
  TrendingUp,
  Timer,
  X,
  Clock,
  ShieldCheck,
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
};

// Per-kind accent — coral for money-at-risk (spike/duplicate), brass for
// heads-up (creep/trial). Drives icon chip + left rail colour.
const ACCENT: Record<AlertKind, string> = {
  spike: "var(--coral)",
  duplicate: "var(--coral)",
  creep: "var(--brass)",
  trial: "var(--brass)",
};

const KIND_LABEL: Record<AlertKind, string> = {
  spike: "Spending spike",
  duplicate: "Duplicate charge",
  creep: "Price creep",
  trial: "Trial ending",
};

function snoozeDate(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

export function AlertsPanel({
  alerts,
  compact = false,
  limit,
}: {
  alerts: Alert[];
  compact?: boolean;
  limit?: number;
}) {
  const shown = typeof limit === "number" ? alerts.slice(0, limit) : alerts;
  const hidden = alerts.length - shown.length;

  if (alerts.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--jade)_35%,transparent)] text-[var(--jade)]">
            <ShieldCheck size={16} />
          </span>
          <div>
            <p className="text-sm font-medium text-[var(--paper)]">Nothing unusual</p>
            <p className="text-xs text-[var(--muted)]">
              No spending spikes, duplicate charges, or subscription surprises right now.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-6 shadow-[var(--elev-2)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Alerts</p>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {alerts.length} {alerts.length === 1 ? "thing" : "things"} worth a look
          </p>
        </div>
        {compact && (
          <Link href="/insights" className="text-xs text-[var(--brass)] hover:underline">
            All insights →
          </Link>
        )}
      </div>

      <div className="space-y-3">
        {shown.map((a) => (
          <AlertCard key={a.key} alert={a} compact={compact} />
        ))}
      </div>

      {hidden > 0 && (
        <Link
          href="/insights"
          className="mt-4 block text-center text-xs text-[var(--muted)] hover:text-[var(--paper)]"
        >
          +{hidden} more on Insights →
        </Link>
      )}
    </div>
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
        </div>
      </div>
    </div>
  );
}
