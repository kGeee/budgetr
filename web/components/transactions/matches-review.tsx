"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, X } from "lucide-react";
import { SectionHead } from "@/components/ui/statement";
import { Amount, shortDate } from "@/components/transactions/ledger-bits";
import { confirmMatch, dismissMatch } from "@/lib/actions";
import type { MatchLeg, MatchSuggestion } from "@/lib/matching";

/**
 * Ruled list of suggested refund/transfer matches. Each suggestion is a pair of
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
    <section aria-label="Possible matches">
      <SectionHead title="Possible matches" count={visible.length} />
      <p className="pb-1 pt-3 text-[13px] text-[var(--muted)]">
        {visible.length} offsetting {visible.length === 1 ? "pair" : "pairs"}. Link them to skip
        double-counting.
      </p>

      <ul>
        {visible.map((s) => {
          const key = pairKey(s);
          const currency = s.a.currency ?? s.b.currency ?? "USD";
          return (
            <li key={key} className="flex flex-col gap-2.5 border-b border-line pb-3.5 pt-3">
              <div className="flex items-center gap-2.5 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brass-dim)] px-2.5 py-0.5 text-[var(--brass)]">
                  <ArrowLeftRight size={11} /> {s.kind}
                </span>
                <span className="text-[var(--muted)]">
                  {s.daysApart === 0 ? "same day" : `${s.daysApart}d apart`}
                </span>
              </div>
              <MatchLegLine leg={s.a} currency={currency} />
              <MatchLegLine leg={s.b} currency={currency} />
              <div className="flex items-center gap-2">
                <button
                  disabled={pending}
                  onClick={() => act(s, () => confirmMatch(s.a.id, s.b.id, s.kind))}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--jade)] px-4.5 text-sm font-semibold text-[var(--on-jade)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
                >
                  <Check size={14} /> Link
                </button>
                <button
                  disabled={pending}
                  onClick={() => act(s, () => dismissMatch(s.a.id, s.b.id))}
                  aria-label="Dismiss suggestion"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--paper)] active:scale-[0.98] disabled:opacity-50"
                >
                  <X size={14} /> Ignore
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Linked pairs drop out of cashflow and spending. Ignored pairs are never suggested again.
      </p>
    </section>
  );
}

function MatchLegLine({ leg, currency }: { leg: MatchLeg; currency: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="min-w-0 truncate">
        <span className="font-medium">{leg.displayName}</span>
        <span className="text-[13px] text-[var(--muted)]">
          {" · "}
          {leg.accountName ?? "—"} · {shortDate(leg.date)}
        </span>
      </span>
      <Amount amount={leg.amount} currency={currency} className="shrink-0" />
    </div>
  );
}

/** Stable key for a pair regardless of leg order. */
function pairKey(s: MatchSuggestion): string {
  return [s.a.id, s.b.id].sort().join("|");
}
