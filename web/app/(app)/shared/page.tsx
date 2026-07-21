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
  const owing = people.filter((p) => p.balance > 0.01).length;

  return (
    <div className="space-y-7">
      <PageHead title="Shared" />

      <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-6">
        <p className="eyebrow">Owed to you</p>
        <p className="display-1 mt-2 font-display text-5xl tabular">
          {formatCurrency(outstanding)}
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {people.length === 0
            ? "Split a transaction from its detail panel to start tracking what friends owe you."
            : owing === 0
              ? "Everyone's square."
              : `Across ${owing} ${owing === 1 ? "person" : "people"}.`}
        </p>
      </div>

      <SharedView
        people={people}
        expenses={expenses}
        settlements={settlements}
        suggestions={suggestions}
      />
    </div>
  );
}
