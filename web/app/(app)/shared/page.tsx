import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { SharedView } from "@/components/shared-view";
import { Hero, Mark, Stat, StatStrip } from "@/components/ui/statement";
import { sharedVerdict } from "@/lib/shared-verdict";
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

  const verdict = sharedVerdict({ peopleCount: people.length, owing, youOwe, returned });

  return (
    <div className="space-y-7">
      <PageHead title="Shared" />

      <section className="rise space-y-5" aria-label="Owed to you">
        <Hero
          eyebrow="Owed to you"
          figure={formatCurrency(outstanding)}
          verdict={
            <>
              {verdict.lead}
              {verdict.amount != null && (
                <>
                  {" "}
                  <Mark tone={verdict.tone}>{formatCurrency(verdict.amount)}</Mark> {verdict.tail}
                </>
              )}
            </>
          }
        >
          {suggestions.length > 0 && (
            <Link
              href="#confirm"
              className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] px-3.5 py-2 text-xs font-medium text-[var(--brass)] transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--brass)_20%,transparent)]"
            >
              <Sparkles size={13} aria-hidden />
              {suggestions.length} {suggestions.length === 1 ? "repayment" : "repayments"} to
              confirm
            </Link>
          )}
        </Hero>

        {/* Lifetime ledger — the context that makes the headline number mean
            something: what went out, what came back, how complete that is. */}
        {fronted > 0 && (
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
        )}
        {(fronted > 0 || youOwe > 0.01) && (
          <StatStrip>
            {fronted > 0 && <Stat label="Fronted all-time" value={formatCurrency(fronted)} />}
            {fronted > 0 && (
              <Stat
                label="Paid back"
                value={formatCurrency(returned)}
                tone="jade"
                sub={`${recovered}% recovered`}
              />
            )}
            {youOwe > 0.01 && (
              <Stat label="You owe" value={formatCurrency(youOwe)} tone="coral" />
            )}
            {owing > 0 && (
              <Stat label="Owing you" value={owing} sub={owing === 1 ? "person" : "people"} />
            )}
          </StatStrip>
        )}
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
