"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, Link2, X } from "lucide-react";
import { confirmMatch, dismissMatch } from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type { MatchSuggestion } from "@/lib/matching";

/**
 * Review card for suggested refund/transfer matches. Each suggestion is a pair of
 * offsetting transactions the user can Confirm (link them, dropping both from
 * cashflow/spend) or Dismiss (tombstone so it's never re-suggested). Rows fade out
 * optimistically while their action runs; a `router.refresh()` re-reads the list.
 */
export function MatchesReview({ suggestions }: { suggestions: MatchSuggestion[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Ids of pairs already actioned this render, hidden immediately for responsiveness.
  const [done, setDone] = useState<Set<string>>(new Set());

  if (suggestions.length === 0) return null;

  const visible = suggestions.filter((s) => !done.has(pairKey(s)));
  if (visible.length === 0) return null;

  function act(s: MatchSuggestion, fn: () => Promise<unknown>) {
    setDone((prev) => new Set(prev).add(pairKey(s)));
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_5%,var(--panel))] p-6 shadow-[var(--elev-2)]">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--brass-dim)] bg-[var(--panel)] text-[var(--brass)]">
          <Link2 size={16} />
        </span>
        <div>
          <p className="eyebrow">Possible matches</p>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {visible.length} offsetting {visible.length === 1 ? "pair" : "pairs"} — link them to
            skip double-counting
          </p>
        </div>
      </div>

      <ul className="space-y-2.5">
        {visible.map((s) => {
          const key = pairKey(s);
          const currency = s.a.currency ?? s.b.currency ?? "USD";
          return (
            <li
              key={key}
              className="flex flex-col gap-3 rounded-xl border border-line bg-[var(--panel)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-[var(--panel-2)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--brass)]">
                    <ArrowLeftRight size={11} /> {s.kind}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {s.daysApart === 0 ? "same day" : `${s.daysApart}d apart`}
                  </span>
                </div>
                <div className="grid gap-1">
                  <MatchLegLine
                    name={s.a.displayName}
                    account={s.a.accountName}
                    date={s.a.date}
                    amount={s.a.amount}
                    currency={currency}
                  />
                  <MatchLegLine
                    name={s.b.displayName}
                    account={s.b.accountName}
                    date={s.b.date}
                    amount={s.b.amount}
                    currency={currency}
                  />
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  disabled={pending}
                  onClick={() => act(s, () => confirmMatch(s.a.id, s.b.id, s.kind))}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--jade)] px-3.5 py-1.5 text-sm font-medium text-[var(--on-jade)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
                >
                  <Check size={14} /> Link
                </button>
                <button
                  disabled={pending}
                  onClick={() => act(s, () => dismissMatch(s.a.id, s.b.id))}
                  aria-label="Dismiss suggestion"
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--paper)] active:scale-[0.98] disabled:opacity-50"
                >
                  <X size={14} /> Ignore
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MatchLegLine({
  name,
  account,
  date,
  amount,
  currency,
}: {
  name: string;
  account: string | null;
  date: string;
  amount: number;
  currency: string;
}) {
  const income = amount < 0;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate">
        <span className="font-medium">{name}</span>
        <span className="text-[var(--muted)]">
          {" · "}
          {account ?? "—"} · {date}
        </span>
      </span>
      <span
        className={`mono shrink-0 tabular ${income ? "text-[var(--jade)]" : "text-[var(--paper)]"}`}
      >
        {income ? "+" : "−"}
        {formatCurrency(Math.abs(amount), currency)}
      </span>
    </div>
  );
}

/** Stable key for a pair regardless of leg order. */
function pairKey(s: MatchSuggestion): string {
  return [s.a.id, s.b.id].sort().join("|");
}
