import { PageHead } from "@/components/page-head";
import { SharedView } from "@/components/shared-view";
import { Hero, Mark } from "@/components/ui/statement";
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
    <div className="space-y-9">
      <PageHead title="Shared" />

      <SharedView
        people={people}
        expenses={expenses}
        settlements={settlements}
        suggestions={suggestions}
        hero={
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
            {/* Lifetime ledger — the context that makes the headline number mean
                something: what went out, what came back, how complete that is. */}
            {(fronted > 0 || youOwe > 0.01) && (
              <div className="flex max-w-[520px] flex-col gap-2.5">
                {fronted > 0 && (
                  <div
                    role="progressbar"
                    aria-valuenow={recovered}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Share of money you fronted that has come back"
                    className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--jade)] transition-[width] duration-500 ease-out"
                      style={{ width: `${recovered}%` }}
                    />
                  </div>
                )}
                <dl className="mono flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                  {fronted > 0 && (
                    <>
                      <div className="flex gap-1.5">
                        <dt className="text-[var(--muted)]">Fronted</dt>
                        <dd>{formatCurrency(fronted)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-[var(--muted)]">Returned</dt>
                        <dd>{formatCurrency(returned)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-[var(--muted)]">Recovered</dt>
                        <dd>{recovered}%</dd>
                      </div>
                    </>
                  )}
                  {youOwe > 0.01 && (
                    <div className="flex gap-1.5">
                      <dt className="text-[var(--muted)]">You owe</dt>
                      <dd className="text-[var(--coral)]">{formatCurrency(youOwe)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </Hero>
        }
      />
    </div>
  );
}
