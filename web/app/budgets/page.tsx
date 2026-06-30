import { PageHead } from "@/components/page-head";
import { BudgetEditor } from "@/components/budget-editor";
import { BudgetPaceChart } from "@/components/charts";
import { Card } from "@/components/ui/card";
import {
  getBudgetSpendByDay,
  getBudgetsWithSpend,
  getCategories,
  getMonthlyBudgetSummary,
  getTagBudgetsWithSpend,
} from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const rows = getBudgetsWithSpend();
  const tagRows = getTagBudgetsWithSpend();
  const categories = getCategories();
  const { totalBudget, totalSpent, left, month } = getMonthlyBudgetSummary();
  const over = left < 0;
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Build the cumulative-spend vs budget-pace series for the budget month.
  const dailySpend = getBudgetSpendByDay();
  const [yy, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const isCurrentMonth = new Date().toISOString().slice(0, 7) === month;
  const lastActualDay = isCurrentMonth
    ? Math.min(new Date().getDate(), daysInMonth)
    : daysInMonth;
  const spentByDate = new Map(dailySpend.map((d) => [d.date, d.spent]));
  let cum = 0;
  const paceData = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    cum += spentByDate.get(date) ?? 0;
    paceData.push({
      date,
      spent: d <= lastActualDay ? cum : null,
      pace: (totalBudget * d) / daysInMonth,
    });
  }
  const spentToDate = paceData[lastActualDay - 1]?.spent ?? totalSpent;
  const paceToDate = (totalBudget * lastActualDay) / daysInMonth;
  const aheadOfPace = spentToDate > paceToDate;
  const projected = lastActualDay > 0 ? (spentToDate / lastActualDay) * daysInMonth : 0;

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

      {totalBudget > 0 && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <span className="eyebrow">Spending pace · {monthLabel}</span>
            <span className="flex items-center gap-3 text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: aheadOfPace ? "#f0897b" : "#6fe3a6" }}
                />
                Spent
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-px w-3 border-t border-dashed border-[var(--muted)]" />
                Budget pace
              </span>
            </span>
          </div>
          <div className="px-3 py-5 sm:px-5">
            <BudgetPaceChart data={paceData} over={aheadOfPace} />
          </div>
          <div className="border-t border-line px-6 py-3 text-xs text-[var(--muted)]">
            {aheadOfPace ? "Ahead of pace" : "On pace"} · {formatCurrency(spentToDate)} spent vs{" "}
            {formatCurrency(paceToDate)} budgeted so far · projected {formatCurrency(projected)} of{" "}
            {formatCurrency(totalBudget)}
          </div>
        </Card>
      )}

      <div>
        <p className="eyebrow mb-3">Spending categories</p>
        <BudgetEditor rows={rows} categories={categories} />
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
