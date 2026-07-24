"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CalendarDays,
  ListChecks,
  PieChart,
  Receipt,
  Store,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { CashflowChart, CategoryChart, NetWorthChart } from "@/components/charts";
import { SpendHeatmap } from "@/components/spend-heatmap";
import { ReviewInbox } from "@/components/review-inbox";
import { UpcomingBills } from "@/components/upcoming-bills";
import { CategoryIcon } from "@/components/category-pill";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type {
  CategoryRow,
  NetWorth,
  PeriodTotals,
  SpendShift,
  TransactionRow,
  WidgetData,
  WidgetType,
} from "@/lib/queries";

/**
 * Static metadata for every widget kind — the label, one-line blurb, icon, and
 * the default config a freshly-added widget starts with. Shared by the picker
 * (what you can add) and the renderer (the card header). Column span lets wide
 * charts (net-worth, cashflow) claim the full grid width.
 */
export const WIDGET_META: Record<
  WidgetType,
  { label: string; blurb: string; icon: LucideIcon; wide: boolean; defaultConfig: Record<string, number> }
> = {
  "net-worth": {
    label: "Net worth",
    blurb: "Assets minus liabilities over time",
    icon: Activity,
    wide: true,
    defaultConfig: {},
  },
  cashflow: {
    label: "Cashflow",
    blurb: "Income vs spending, by month",
    icon: BarChart3,
    wide: true,
    defaultConfig: { months: 6 },
  },
  "spend-by-category": {
    label: "Spend by category",
    blurb: "Where the money went",
    icon: PieChart,
    wide: false,
    defaultConfig: { days: 30 },
  },
  "top-vendors": {
    label: "Top vendors",
    blurb: "Your biggest merchants",
    icon: Store,
    wide: false,
    defaultConfig: { days: 90, limit: 8 },
  },
  "daily-spend": {
    label: "Daily spend",
    blurb: "A year of spending, day by day",
    icon: CalendarDays,
    wide: true,
    defaultConfig: {},
  },
  "budget-summary": {
    label: "Budget summary",
    blurb: "This month against plan",
    icon: Target,
    wide: false,
    defaultConfig: {},
  },
  "net-worth-summary": {
    label: "Net worth",
    blurb: "Headline number, assets vs liabilities, trend",
    icon: Wallet,
    wide: true,
    defaultConfig: {},
  },
  "spending-review": {
    label: "Spending review",
    blurb: "This month vs last, and what moved",
    icon: Receipt,
    wide: true,
    defaultConfig: {},
  },
  "review-queue": {
    label: "Review queue",
    blurb: "Transactions that need a category",
    icon: ListChecks,
    wide: true,
    defaultConfig: { limit: 6 },
  },
  "recent-activity": {
    label: "Recent activity",
    blurb: "Your latest transactions",
    icon: Activity,
    wide: false,
    defaultConfig: { limit: 6 },
  },
  "upcoming-bills": {
    label: "Upcoming bills",
    blurb: "Predicted charges in the next two weeks",
    icon: CalendarClock,
    wide: false,
    defaultConfig: { days: 14 },
  },
};

export const WIDGET_TYPES = Object.keys(WIDGET_META) as WidgetType[];

/**
 * Widgets that render their own titled container (an inbox, a hero card, a bills
 * list) rather than a bare chart. They skip the standard Card + CardHeader
 * wrapper so we don't double up borders/titles.
 */
const SELF_CONTAINED = new Set<WidgetType>([
  "net-worth-summary",
  "review-queue",
  "recent-activity",
  "upcoming-bills",
  "spending-review",
]);

/** Renders one resolved widget, dispatching on its data `type`. Chart widgets
 *  get a standard titled Card; self-contained widgets render their own shell. */
export function DashboardWidget({
  data,
  categories,
}: {
  data: WidgetData;
  categories: CategoryRow[];
}) {
  if (SELF_CONTAINED.has(data.type)) {
    return <WidgetBody data={data} categories={categories} />;
  }
  const meta = WIDGET_META[data.type];
  const Icon = meta.icon;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon size={13} className="text-[var(--brass)]" />
          {meta.label}
        </CardTitle>
      </CardHeader>
      <WidgetBody data={data} categories={categories} />
    </Card>
  );
}

function WidgetBody({
  data,
  categories,
}: {
  data: WidgetData;
  categories: CategoryRow[];
}) {
  switch (data.type) {
    case "net-worth":
      return <NetWorthChart data={data.series} />;
    case "cashflow":
      return <CashflowChart data={data.series} />;
    case "spend-by-category":
      return (
        <CategoryChart
          data={data.series.map((c) => ({ category: c.category, total: c.total }))}
        />
      );
    case "top-vendors":
      return <TopVendorsList merchants={data.merchants} />;
    case "daily-spend":
      return (
        <SpendHeatmap
          data={data.series}
          start={data.start}
          end={data.end}
          categories={categories}
        />
      );
    case "budget-summary":
      return <BudgetSummaryBody summary={data.summary} />;
    case "net-worth-summary":
      return (
        <NetWorthSummaryBody
          nw={data.nw}
          series={data.series}
          change={data.change}
          changePct={data.changePct}
        />
      );
    case "review-queue":
      return (
        <ReviewQueueBody
          transactions={data.transactions}
          total={data.total}
          categories={categories}
        />
      );
    case "recent-activity":
      return <RecentActivityBody transactions={data.transactions} />;
    case "upcoming-bills":
      return <UpcomingBills bills={data.bills} />;
    case "spending-review":
      return (
        <SpendingReviewBody
          label={data.label}
          prevLabel={data.prevLabel}
          totals={data.totals}
          prevTotals={data.prevTotals}
          shifts={data.shifts}
        />
      );
  }
}

/** Shared delta pill — a signed currency change with its percentage. */
function DeltaPill({ value, pct }: { value: number; pct: number }) {
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

function NetWorthSummaryBody({
  nw,
  series,
  change,
  changePct,
}: {
  nw: NetWorth;
  series: { date: string; netWorth: number }[];
  change: number;
  changePct: number;
}) {
  return (
    <Card className="h-full">
      <p className="eyebrow">Total net worth</p>
      <p className="mt-2 font-display text-4xl tabular sm:text-5xl">{formatCurrency(nw.net)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <DeltaPill value={change} pct={changePct} />
        <span className="text-xs text-[var(--muted)]">since first snapshot</span>
      </div>
      <div className="mt-5 flex gap-8">
        <div>
          <p className="eyebrow">Assets</p>
          <p className="mt-1 font-display text-xl tabular">{formatCurrency(nw.assets)}</p>
        </div>
        <span className="w-px self-stretch bg-line" />
        <div>
          <p className="eyebrow">Liabilities</p>
          <p className="mt-1 font-display text-xl tabular text-[var(--coral)]">
            {formatCurrency(nw.liabilities)}
          </p>
        </div>
      </div>
      <div className="mt-6">
        <NetWorthChart data={series} />
      </div>
    </Card>
  );
}

function ReviewQueueBody({
  transactions,
  total,
  categories,
}: {
  transactions: TransactionRow[];
  total: number;
  categories: CategoryRow[];
}) {
  if (total === 0) {
    return (
      <Card className="flex h-full min-h-[160px] flex-col items-center justify-center text-center">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-line text-[var(--jade)]">
          <ListChecks size={20} />
        </span>
        <p className="mt-4 font-display text-lg text-[var(--paper)]">All caught up</p>
        <p className="mt-1 text-sm text-[var(--muted)]">Nothing waiting to be categorized.</p>
      </Card>
    );
  }
  return <ReviewInbox transactions={transactions} categories={categories} total={total} />;
}

function RecentActivityBody({ transactions }: { transactions: TransactionRow[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <ul className="-mx-2">
        {transactions.map((t) => {
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
              <span
                className={`mono w-24 shrink-0 text-right text-sm ${income ? "text-[var(--jade)]" : "text-[var(--paper)]"}`}
              >
                {income ? "+" : "−"}
                {formatCurrency(Math.abs(t.amount), t.currency ?? "USD")}
              </span>
            </li>
          );
        })}
        {transactions.length === 0 && (
          <li className="px-2 py-6 text-sm text-[var(--muted)]">No transactions yet — hit Sync.</li>
        )}
      </ul>
    </Card>
  );
}

function SpendingReviewBody({
  label,
  prevLabel,
  totals,
  prevTotals,
  shifts,
}: {
  label: string;
  prevLabel: string;
  totals: PeriodTotals;
  prevTotals: PeriodTotals;
  shifts: SpendShift[];
}) {
  const delta = totals.expenses - prevTotals.expenses;
  const pct = prevTotals.expenses > 0 ? (delta / prevTotals.expenses) * 100 : 0;
  // For spending, up (spent more) is the "bad"/coral direction.
  const up = delta > 0;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt size={13} className="text-[var(--brass)]" />
          Spending review
        </CardTitle>
        <Link href="/review" className="text-xs text-[var(--brass)] hover:underline">
          Full review →
        </Link>
      </CardHeader>
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-4xl tabular">{formatCurrency(totals.expenses)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${
            up
              ? "border-[color-mix(in_srgb,var(--coral)_35%,transparent)] bg-[color-mix(in_srgb,var(--coral)_10%,transparent)] text-[var(--coral)]"
              : "border-[color-mix(in_srgb,var(--jade)_35%,transparent)] bg-[color-mix(in_srgb,var(--jade)_10%,transparent)] text-[var(--jade)]"
          }`}
        >
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {up ? "+" : "−"}
          {formatCurrency(Math.abs(delta))} ({Math.abs(pct).toFixed(0)}%)
        </span>
        <span className="text-xs text-[var(--muted)]">vs {prevLabel}</span>
      </div>

      {shifts.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Biggest movers</p>
          <ul className="space-y-2">
            {shifts.map((s) => {
              const more = s.delta > 0;
              return (
                <li key={s.category} className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-[var(--brass)]">
                    <CategoryIcon icon={s.icon} size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--paper)]">
                    {s.category}
                  </span>
                  <span
                    className={`mono shrink-0 text-sm ${more ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}
                  >
                    {more ? "+" : "−"}
                    {formatCurrency(Math.abs(s.delta))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function TopVendorsList({
  merchants,
}: {
  merchants: { vendor: string; total: number; count: number }[];
}) {
  if (merchants.length === 0)
    return (
      <div className="flex h-[200px] flex-col items-center justify-center gap-1 text-center">
        <p className="font-display text-base text-[var(--paper)]">No vendors yet</p>
        <p className="text-sm text-[var(--muted)]">Nothing recorded in this window.</p>
      </div>
    );
  const max = Math.max(...merchants.map((m) => m.total));
  return (
    <ul className="space-y-3">
      {merchants.map((m) => (
        <li key={m.vendor} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-[var(--paper)]">{m.vendor}</span>
            <span className="mono shrink-0 text-sm text-[var(--paper)]">
              {formatCurrency(m.total)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
            <div
              className="h-full rounded-full bg-[var(--brass)]"
              style={{ width: `${max > 0 ? (m.total / max) * 100 : 0}%` }}
            />
          </div>
          <p className="mono text-xs text-[var(--muted)]">{m.count} transactions</p>
        </li>
      ))}
    </ul>
  );
}

function BudgetSummaryBody({
  summary,
}: {
  summary: { totalBudget: number; totalSpent: number; left: number; month: string };
}) {
  if (summary.totalBudget <= 0)
    return (
      <div className="flex h-[200px] flex-col items-center justify-center gap-1 text-center">
        <p className="font-display text-base text-[var(--paper)]">No budgets set</p>
        <p className="text-sm text-[var(--muted)]">Set monthly limits to track against plan.</p>
      </div>
    );
  const over = summary.left < 0;
  const monthLabel = new Date(`${summary.month}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return (
    <div>
      <p className="eyebrow">{monthLabel}</p>
      <p className={`mt-2 font-display text-4xl tabular ${over ? "text-[var(--coral)]" : ""}`}>
        {formatCurrency(Math.abs(summary.left))}
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {over ? "over " : "left of "}
        {formatCurrency(summary.totalBudget)} budgeted
      </p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
        <div
          className={`h-full rounded-full ${over ? "bg-[var(--coral)]" : "bg-[var(--jade)]"}`}
          style={{ width: `${Math.min((summary.totalSpent / summary.totalBudget) * 100, 100)}%` }}
        />
      </div>
      <p className="mono mt-2 text-xs text-[var(--muted)]">
        {formatCurrency(summary.totalSpent)} spent
      </p>
    </div>
  );
}
