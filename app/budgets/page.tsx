import { PageHead } from "@/components/page-head";
import { BudgetEditor } from "@/components/budget-editor";
import {
  getBudgetsWithSpend,
  getMonthlyBudgetSummary,
  getTagBudgetsWithSpend,
} from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const rows = getBudgetsWithSpend();
  const tagRows = getTagBudgetsWithSpend();
  const { totalBudget, totalSpent, left, month } = getMonthlyBudgetSummary();
  const over = left < 0;
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-7">
      <PageHead title="Budgets" />

      <div className="flex flex-col gap-6 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">{over ? "Over budget" : "Left to spend"}</p>
          <p
            className={`mt-2 font-display text-5xl leading-none tabular ${over ? "text-[var(--coral)]" : ""}`}
          >
            {formatCurrency(Math.abs(left))}
          </p>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {formatCurrency(totalSpent)} spent of {formatCurrency(totalBudget)} budgeted ·{" "}
            {monthLabel}
          </p>
        </div>
      </div>

      <div>
        <p className="eyebrow mb-3">Spending categories</p>
        <BudgetEditor rows={rows} />
      </div>

      {tagRows.length > 0 && (
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <p className="eyebrow">Tag budgets</p>
            <span className="text-xs text-[var(--muted)]">counts alongside categories</span>
          </div>
          <BudgetEditor rows={tagRows} kind="tag" emptyLabel="No tags yet." />
        </div>
      )}
    </div>
  );
}
