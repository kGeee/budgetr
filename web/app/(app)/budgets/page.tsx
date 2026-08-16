import { endOfMonth, format } from "date-fns";
import { PageHead } from "@/components/page-head";
import { BudgetsView } from "@/components/budget/budgets-view";
import { IncompletePeriodNotice } from "@/components/data-freshness";
import { getLatestTransactionDate, periodCoverage } from "@/lib/data-freshness";
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

  // getBudgetMonth() has always quietly fallen back to the last month with
  // transactions, which is the right behaviour and the wrong silence: the page
  // rendered July's envelopes under today's date with nothing saying so. Say
  // which month is on screen, and why it isn't this one.
  const currentMonth = new Date().toISOString().slice(0, 7);
  const fellBack = month !== currentMonth;
  const currentLabel = new Date(`${currentMonth}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const coverage = fellBack
    ? periodCoverage(
        `${currentMonth}-01`,
        format(endOfMonth(new Date(`${currentMonth}-01T00:00:00`)), "yyyy-MM-dd"),
        getLatestTransactionDate(),
      )
    : null;

  // One per-category/day set powers both the whole-month pace line and any
  // single envelope's, so focusing a category needs no server round-trip.
  const spendByCategoryDay = getBudgetSpendByCategoryDay();

  return (
    <div className="space-y-7">
      <PageHead title="Budgets" />
      {coverage && (
        <IncompletePeriodNotice
          requestedLabel={currentLabel}
          shownLabel={monthLabel}
          coverage={coverage}
        />
      )}
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
