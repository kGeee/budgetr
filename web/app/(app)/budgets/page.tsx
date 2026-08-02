import { PageHead } from "@/components/page-head";
import { BudgetsView } from "@/components/budget/budgets-view";
import {
  getBudgetSpendByCategoryDay,
  getCategories,
  getEnvelopeBudgets,
  getMonthlyBudgetSummary,
  getTagBudgetsWithSpend,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const rows = getEnvelopeBudgets();
  const tagRows = getTagBudgetsWithSpend();
  // Net balance carried into this month across all envelope-enabled categories.
  const carriedForward = rows.reduce((sum, r) => sum + (r.rollover ? r.carryIn : 0), 0);
  const hasRollovers = rows.some((r) => r.rollover);
  const categories = getCategories();
  const { totalBudget, totalSpent, left, month } = getMonthlyBudgetSummary();
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // One per-category/day set powers both the whole-month pace line and any
  // single envelope's, so focusing a category needs no server round-trip.
  const spendByCategoryDay = getBudgetSpendByCategoryDay();

  return (
    <div className="space-y-7">
      <PageHead title="Budgets" />
      <BudgetsView
        month={month}
        monthLabel={monthLabel}
        totalBudget={totalBudget}
        totalSpent={totalSpent}
        left={left}
        carriedForward={carriedForward}
        hasRollovers={hasRollovers}
        envelopes={rows}
        tags={tagRows}
        spendByCategoryDay={spendByCategoryDay}
        categories={categories}
      />
    </div>
  );
}
