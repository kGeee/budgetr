import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { SharedView } from "@/components/shared-view";
import { getPeopleBalances, getSettlements, getSharedExpenses, suggestSettlements } from "@/lib/sharing";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Shared expenses — money you fronted for other people and what's come back.
 *
 * Everything here is derived from the shared_expenses / expense_shares /
 * settlements tables; the reporting side of it (keeping fronted money out of
 * your spend) is handled by the transaction_splits the splitter writes, so this
 * page is purely a ledger view.
 */
export default function SharedPage() {
  const people = getPeopleBalances();
  const expenses = getSharedExpenses();
  const settlements = getSettlements();
  const suggestions = suggestSettlements();

  const outstanding = people.reduce((s, p) => s + Math.max(p.balance, 0), 0);
  const youOwe = people.reduce((s, p) => s + Math.max(-p.balance, 0), 0);
  const owing = people.filter((p) => p.balance > 0.01).length;

  // Lifetime totals drive the recovery meter: of everything you've ever
  // fronted, how much has actually found its way back.
  const fronted = people.reduce((s, p) => s + p.owed, 0);
  const returned = people.reduce((s, p) => s + p.settled, 0);
  const recovered = fronted > 0 ? Math.min(100, Math.round((returned / fronted) * 100)) : 0;

  return (
    <div className="space-y-7">
      <PageHead title="Shared" />

      <section className="rise rounded-[var(--radius)] border border-line bg-gradient-to-b from-[var(--panel-2)] to-[var(--panel)] p-6 shadow-[var(--elev-2)] sm:p-7">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
          <div className="min-w-0">
            <p className="eyebrow">Owed to you</p>
            <p className="display-1 mt-2 font-display text-5xl tabular sm:text-6xl">
              {formatCurrency(outstanding)}
            </p>
            <p className="mt-3 max-w-md text-sm text-[var(--muted)]">
              {people.length === 0
                ? "Split a transaction from its detail panel to start tracking what friends owe you."
                : owing === 0
                  ? "Everyone's square."
                  : `Across ${owing} ${owing === 1 ? "person" : "people"}.`}
              {youOwe > 0.01 && (
                <>
                  {" "}
                  You owe <span className="mono text-[var(--coral)]">{formatCurrency(youOwe)}</span>{" "}
                  back.
                </>
              )}
            </p>

            {suggestions.length > 0 && (
              <Link
                href="#confirm"
                className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] px-3.5 py-2 text-xs font-medium text-[var(--brass)] transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--brass)_20%,transparent)]"
              >
                <Sparkles size={13} aria-hidden />
                {suggestions.length} {suggestions.length === 1 ? "repayment" : "repayments"} to
                confirm
              </Link>
            )}
          </div>

          {/* Lifetime ledger — the context that makes the headline number mean
              something: what went out, what came back, how complete that is. */}
          {fronted > 0 && (
            <dl className="w-full shrink-0 space-y-4 rounded-2xl border border-line bg-[color-mix(in_srgb,var(--ink)_45%,transparent)] p-5 lg:w-72">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-xs text-[var(--muted)]">Fronted all-time</dt>
                <dd className="mono text-sm tabular">{formatCurrency(fronted)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-xs text-[var(--muted)]">Paid back</dt>
                <dd className="mono text-sm tabular text-[var(--jade)]">
                  {formatCurrency(returned)}
                </dd>
              </div>
              <div className="space-y-2 pt-1">
                <div
                  role="progressbar"
                  aria-valuenow={recovered}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Share of money you fronted that has come back"
                  className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]"
                >
                  <div
                    className="h-full rounded-full bg-[var(--jade)] transition-[width] duration-500 ease-out"
                    style={{ width: `${recovered}%` }}
                  />
                </div>
                <p className="text-[11px] text-[var(--faint)]">{recovered}% recovered</p>
              </div>
            </dl>
          )}
        </div>
      </section>

      <SharedView
        people={people}
        expenses={expenses}
        settlements={settlements}
        suggestions={suggestions}
      />
    </div>
  );
}
