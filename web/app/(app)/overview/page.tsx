import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHead } from "@/components/page-head";
import { CategoryChart } from "@/components/charts";
import { CashflowCard } from "@/components/cashflow-card";
import { ValueHistory } from "@/components/value-history";
import { buildReconstructedSeries, getTickerHistories, overlayNetWorth } from "@/lib/portfolio-history";
import { CategoryIcon } from "@/components/category-pill";
import { BudgetBar } from "@/components/budget-bar";
import { ReviewInbox } from "@/components/review-inbox";
import { AlertsPanel } from "@/components/alerts-panel";
import { UpcomingBills } from "@/components/upcoming-bills";
import { detectAnomalies } from "@/lib/anomalies";
import { PlaidLink } from "@/components/plaid-link";
import { hasPlaidCredentials } from "@/lib/plaid";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getBudgetsWithSpend,
  getCategories,
  getItems,
  getManualHoldings,
  getCashflowBreakdown,
  getMonthlyBudgetSummary,
  getMonthlyCashflow,
  getNetWorth,
  getNetWorthSeries,
  getRecentTransactions,
  getSpendingByCategory,
  getTransactionsToReview,
  getUpcomingBills,
} from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";
// Allow the manual-holding Yahoo history fetches to hit the Data Cache rather
// than being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

export default async function Dashboard() {
  const items = getItems();

  // Brand-new install with no Plaid keys yet → guided onboarding. Once keys are
  // set (but nothing connected), fall through to the inline empty state below.
  if (!hasPlaidCredentials() && items.length === 0) redirect("/onboarding");
  if (items.length === 0) return <EmptyState />;

  const baseNw = getNetWorth();
  const baseSeries = getNetWorthSeries();

  // Fold off-Plaid holdings (crypto, fixed-value assets) into net worth so the
  // dashboard reflects everything, with a live "today" point.
  const manual = getManualHoldings();
  const manualSymbols = manual.map((m) => m.symbol).filter((s): s is string => Boolean(s));
  const manualHistories = await getTickerHistories(manualSymbols);
  const manualTickeredSeries = buildReconstructedSeries(
    manual.filter((m) => m.symbol).map((m) => ({ ticker: m.symbol, quantity: m.quantity })),
    [],
    manualHistories,
  );
  const fixedValueTotal = manual
    .filter((m) => !m.symbol)
    .reduce((s, m) => s + (m.manualValue ?? 0), 0);
  const manualTickeredToday =
    manualTickeredSeries.length > 0
      ? manualTickeredSeries[manualTickeredSeries.length - 1].value
      : 0;
  const manualToday = manualTickeredToday + fixedValueTotal;

  const nw = {
    assets: baseNw.assets + manualToday,
    liabilities: baseNw.liabilities,
    net: baseNw.net + manualToday,
  };
  const todayStr = new Date().toISOString().slice(0, 10);
  const series = overlayNetWorth(baseSeries, manualTickeredSeries, fixedValueTotal, {
    date: todayStr,
    net: nw.net,
  });
  const cashflow = getMonthlyCashflow();
  const cashflowBreakdown = getCashflowBreakdown();
  const categories = getSpendingByCategory(30);
  const recent = getRecentTransactions(7);
  const toReview = getTransactionsToReview(6);
  const reviewTotal = getTransactionsToReview(999).length;
  const allCategories = getCategories();
  const budgetSummary = getMonthlyBudgetSummary();
  const budgetRows = getBudgetsWithSpend();
  const topBudgets = budgetRows.filter((b) => b.budget != null).slice(0, 5);
  const overBudget = budgetSummary.left < 0;
  const budgetMonthLabel = new Date(`${budgetSummary.month}-01T00:00:00`).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );
  const upcoming = getUpcomingBills(14);
  const alerts = detectAnomalies();

  const first = series[0]?.netWorth ?? nw.net;
  const change = nw.net - first;
  const changePct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;

  return (
    <div className="space-y-7">
      <PageHead title="Overview" />

      {/* Hero — the headline number, set like a private-bank statement. */}
      <Card className="rise overflow-hidden">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">Total net worth</p>
            <p className="display-1 mt-2 font-display text-5xl tabular sm:text-6xl">
              {formatCurrency(nw.net)}
            </p>
            <div className="mt-4 flex items-center gap-4">
              <Delta value={change} pct={changePct} />
              <span className="text-sm text-[var(--muted)]">since first snapshot</span>
            </div>
          </div>
          <div className="flex gap-8">
            <MiniStat label="Assets" value={nw.assets} tone="paper" />
            <span className="w-px self-stretch bg-line" />
            <MiniStat label="Liabilities" value={nw.liabilities} tone="coral" />
          </div>
        </div>
        <div className="mt-7">
          <ValueHistory
            data={series.map((s) => ({ date: s.date, value: s.netWorth }))}
            kind="networth"
          />
        </div>
      </Card>

      {/* Cashflow + category */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <CashflowCard data={cashflow} breakdown={cashflowBreakdown} />

        <Card className="lg:col-span-2 min-w-0">
          <CardHeader>
            <CardTitle>Spending · 30 days</CardTitle>
          </CardHeader>
          <CategoryChart data={categories} />
        </Card>
      </div>

      {/* Monthly spending budget + top categories */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly spending · {budgetMonthLabel}</CardTitle>
            <Link href="/budgets" className="text-xs text-[var(--brass)] hover:underline">
              Budgets →
            </Link>
          </CardHeader>
          {budgetSummary.totalBudget > 0 ? (
            <>
              <p
                className={`font-display text-4xl tabular ${overBudget ? "text-[var(--coral)]" : ""}`}
              >
                {formatCurrency(Math.abs(budgetSummary.left))}
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {overBudget ? "over " : "left of "}
                {formatCurrency(budgetSummary.totalBudget)} budgeted
              </p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
                <div
                  className={`h-full rounded-full ${overBudget ? "bg-[var(--coral)]" : "bg-[var(--jade)]"}`}
                  style={{
                    width: `${Math.min(
                      (budgetSummary.totalSpent / budgetSummary.totalBudget) * 100,
                      100,
                    )}%`,
                  }}
                />
              </div>
              <p className="mono mt-2 text-xs text-[var(--muted)]">
                {formatCurrency(budgetSummary.totalSpent)} spent
              </p>
            </>
          ) : (
            <div className="py-2">
              <p className="text-sm text-[var(--muted)]">
                No budgets yet. Set monthly limits to track spending against plan.
              </p>
              <Link
                href="/budgets"
                className="mt-4 inline-flex items-center rounded-full bg-[var(--jade)] px-4 py-2 text-sm font-medium text-[var(--on-jade)] hover:brightness-105"
              >
                Set budgets
              </Link>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Top categories</CardTitle>
          </CardHeader>
          {topBudgets.length > 0 ? (
            <div className="divide-y divide-line/60">
              {topBudgets.map((row) => (
                <BudgetBar key={row.categoryId} row={row} />
              ))}
            </div>
          ) : (
            <p className="py-2 text-sm text-[var(--muted)]">
              Budgeted categories will appear here once you set limits.
            </p>
          )}
        </Card>
      </div>

      {/* Anomaly alerts — spikes, duplicates, price creep, trials */}
      {alerts.length > 0 && <AlertsPanel alerts={alerts} compact limit={3} />}

      {/* Review queue */}
      {toReview.length > 0 && (
        <ReviewInbox transactions={toReview} categories={allCategories} total={reviewTotal} />
      )}

      {/* Recent activity + upcoming bills */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <ul className="-mx-2">
          {recent.map((t) => {
            const income = t.amount < 0;
            return (
              <li
                key={t.id}
                className="flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-[var(--panel-2)]"
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${
                    income
                      ? "border-[color-mix(in_srgb,var(--jade)_35%,transparent)] text-[var(--jade)]"
                      : "border-line text-[var(--muted)]"
                  }`}
                >
                  {income ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.displayName}</p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-[var(--muted)]">
                    <CategoryIcon icon={t.categoryIcon} size={12} className="text-[var(--brass)]" />
                    {t.categoryName} · {t.accountName}
                  </p>
                </div>
                <span className="hidden text-xs text-[var(--muted)] sm:block">{t.date}</span>
                <span
                  className={`mono w-28 shrink-0 text-right text-sm ${income ? "text-[var(--jade)]" : "text-[var(--paper)]"}`}
                >
                  {income ? "+" : "−"}
                  {formatCurrency(Math.abs(t.amount), t.currency ?? "USD")}
                </span>
              </li>
            );
          })}
          {recent.length === 0 && (
            <li className="px-2 py-6 text-sm text-[var(--muted)]">No transactions yet — hit Sync.</li>
          )}
        </ul>
        </Card>

        <div className="lg:col-span-2">
          <UpcomingBills bills={upcoming} />
        </div>
      </div>
    </div>
  );
}

function Delta({ value, pct }: { value: number; pct: number }) {
  const up = value >= 0;
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${
        up
          ? "border-[color-mix(in_srgb,var(--jade)_35%,transparent)] bg-[color-mix(in_srgb,var(--jade)_10%,transparent)] text-[var(--jade)]"
          : "border-[color-mix(in_srgb,var(--coral)_35%,transparent)] bg-[color-mix(in_srgb,var(--coral)_10%,transparent)] text-[var(--coral)]"
      }`}
    >
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {up ? "+" : "−"}
      {formatCurrency(Math.abs(value))} ({Math.abs(pct).toFixed(1)}%)
    </span>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "paper" | "coral";
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1.5 font-display text-2xl tabular ${tone === "coral" ? "text-[var(--coral)]" : ""}`}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--brass-dim)] bg-[var(--panel)] font-display text-2xl text-[var(--brass)]">
        ₿
      </span>
      <h1 className="mt-6 font-display text-4xl tracking-tight">Open your ledger</h1>
      <p className="mt-3 text-[var(--muted)]">
        Connect your card, brokerage, and bank to track net worth, spending, and income — all
        read-only and stored on this machine. In Plaid Sandbox, search any bank and log in with{" "}
        <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[var(--paper)]">
          user_good
        </code>{" "}
        /{" "}
        <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[var(--paper)]">
          pass_good
        </code>
        .
      </p>
      <div className="mt-8">
        <PlaidLink />
      </div>
    </div>
  );
}
