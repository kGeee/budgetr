"use client";

import {
  Activity,
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
import { SpendHeatmap } from "@/components/budget/spend-heatmap";
import { ReviewInbox } from "@/components/transactions/review-inbox";
import {
  Amount,
  CategoryDot,
  categoryColors,
  shortDate,
} from "@/components/transactions/ledger-bits";
import { UpcomingBills } from "@/components/budget/upcoming-bills";
import { Figure, Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import type { MonthPace } from "@/lib/home-layout";
import {
  WidgetControls,
  type ControlOption,
  type WidgetControlSpec,
} from "@/components/widget-controls";
import { formatCurrency } from "@/lib/utils";
import type {
  BudgetRow,
  BudgetSummary,
  CategoryRow,
  WidgetConfig,
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
 * (what you can add) and the renderer (the section title). Where a widget sits
 * on the page is WIDGET_SLOT in lib/home-layout.
 */
/** Reusable option sets, so every range pill in the app reads the same. */
const DAY_RANGES: ControlOption[] = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "1y", value: 365 },
];
const MONTH_RANGES: ControlOption[] = [
  { label: "3m", value: 3 },
  { label: "6m", value: 6 },
  { label: "12m", value: 12 },
  { label: "24m", value: 24 },
];
const ROW_LIMITS: ControlOption[] = [
  { label: "5", value: 5 },
  { label: "8", value: 8 },
  { label: "12", value: 12 },
];

const range = (options: ControlOption[], fallback: number): WidgetControlSpec => ({
  key: "days",
  title: "Range",
  options,
  fallback,
});
const months = (fallback: number): WidgetControlSpec => ({
  key: "months",
  title: "Range",
  options: MONTH_RANGES,
  fallback,
});
const rows = (fallback: number): WidgetControlSpec => ({
  key: "limit",
  title: "Rows",
  options: ROW_LIMITS,
  fallback,
});
const order = (withCount: boolean): WidgetControlSpec => ({
  key: "sort",
  title: "Order by",
  options: withCount
    ? [
        { label: "$", value: "amount" },
        { label: "#", value: "count" },
        { label: "A–Z", value: "name" },
      ]
    : [
        { label: "$", value: "amount" },
        { label: "A–Z", value: "name" },
      ],
  fallback: "amount",
});

export const WIDGET_META: Record<
  WidgetType,
  {
    label: string;
    blurb: string;
    icon: LucideIcon;
    defaultConfig: Record<string, number>;
    /** Range/order pills shown in this widget's header. */
    controls?: WidgetControlSpec[];
  }
> = {
  "net-worth": {
    label: "Net worth",
    blurb: "Assets minus liabilities over time",
    icon: Activity,
    defaultConfig: {},
  },
  cashflow: {
    label: "Cashflow",
    blurb: "Income vs spending, by month",
    icon: BarChart3,
    defaultConfig: { months: 6 },
    controls: [months(6)],
  },
  "spend-by-category": {
    label: "Spend by category",
    blurb: "Where the money went",
    icon: PieChart,
    defaultConfig: { days: 30 },
    controls: [range(DAY_RANGES, 30), order(false)],
  },
  "top-vendors": {
    label: "Top vendors",
    blurb: "Your biggest merchants",
    icon: Store,
    defaultConfig: { days: 90, limit: 8 },
    controls: [range(DAY_RANGES, 90), order(true), rows(8)],
  },
  "daily-spend": {
    label: "Daily spend",
    blurb: "A year of spending, day by day",
    icon: CalendarDays,
    defaultConfig: {},
  },
  "budget-summary": {
    label: "Budget summary",
    blurb: "This month against plan",
    icon: Target,
    defaultConfig: {},
  },
  "net-worth-summary": {
    label: "Net worth",
    blurb: "Headline number, assets vs liabilities, trend",
    icon: Wallet,
    defaultConfig: {},
  },
  "spending-review": {
    label: "Spending review",
    blurb: "This month vs last, and what moved",
    icon: Receipt,
    defaultConfig: {},
  },
  "review-queue": {
    label: "Review queue",
    blurb: "Transactions that need a category",
    icon: ListChecks,
    defaultConfig: { limit: 6 },
  },
  "recent-activity": {
    label: "Recent activity",
    blurb: "Your latest transactions",
    icon: Activity,
    defaultConfig: { limit: 6 },
  },
  "upcoming-bills": {
    label: "Upcoming bills",
    blurb: "Predicted charges in the next two weeks",
    icon: CalendarClock,
    defaultConfig: { days: 14 },
  },
};

export const WIDGET_TYPES = Object.keys(WIDGET_META) as WidgetType[];

/**
 * Widgets that bring their own title rule (a hero, an inbox, a list with a
 * link beside its name). The rest are a bare chart or list and get the
 * standard section head, with their range pills in it.
 */
const SELF_TITLED = new Set<WidgetType>([
  "net-worth-summary",
  "review-queue",
  "recent-activity",
  "upcoming-bills",
  "spending-review",
  "budget-summary",
]);

const HEAD_LINK = "text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)]";

/** Renders one resolved widget, dispatching on its data `type`. Every widget is
 *  a titled section sitting on the canvas: a rule under its name, ruled rows
 *  beneath, no card. */
export function DashboardWidget({
  id,
  config = {},
  data,
  categories,
}: {
  /** Row id — the range/order controls persist against it. */
  id?: string;
  config?: WidgetConfig;
  data: WidgetData;
  categories: CategoryRow[];
}) {
  if (SELF_TITLED.has(data.type)) {
    return <WidgetBody data={data} categories={categories} />;
  }
  const meta = WIDGET_META[data.type];
  const controls = id && meta.controls?.length ? meta.controls : null;
  return (
    <section aria-label={meta.label}>
      <SectionHead
        title={meta.label}
        action={controls && <WidgetControls widgetId={id!} config={config} specs={controls} />}
      />
      <div className="pt-4">
        <WidgetBody data={data} categories={categories} />
      </div>
    </section>
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
      return <BudgetsBody summary={data.summary} rows={data.rows} pace={data.pace} />;
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
      return <RecentActivityBody transactions={data.transactions} categories={categories} />;
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
  const up = change >= 0;
  const flat = Math.abs(change) < 0.005;
  return (
    // Home's one editorial number sits on the canvas with the sentence that
    // reads it; the trend takes the room a card's padding used to.
    <section
      aria-label="Net worth"
      className="grid h-full gap-x-10 gap-y-6 pb-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <Hero
          eyebrow="Net worth"
          figure={formatCurrency(nw.net)}
          tone={nw.net < 0 ? "coral" : "default"}
          verdict={
            flat ? (
              "Unchanged since your first snapshot."
            ) : (
              <>
                {up ? "Up" : "Down"}{" "}
                <Mark tone={up ? "jade" : "coral"}>{formatCurrency(Math.abs(change))}</Mark> since
                your first snapshot, a {up ? "gain" : "drop"} of {Math.abs(changePct).toFixed(1)}%.
              </>
            )
          }
        />
        <StatStrip className="mt-auto">
          <Stat label="Assets" value={formatCurrency(nw.assets)} />
          <Stat label="Owed" value={formatCurrency(nw.liabilities)} tone="coral" />
        </StatStrip>
      </div>
      <div className="min-w-0 self-end">
        <NetWorthChart data={series} />
      </div>
    </section>
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
      <section aria-label="To review">
        <SectionHead title="To review" />
        <p className="border-b border-line py-3.5 text-sm">
          <span className="font-medium text-[var(--jade)]">All caught up.</span>{" "}
          <span className="text-[var(--muted)]">Nothing waiting to be categorized.</span>
        </p>
      </section>
    );
  }
  return (
    <ReviewInbox
      title="To review"
      transactions={transactions}
      categories={categories}
      total={total}
      href="/transactions?view=review"
    />
  );
}

function RecentActivityBody({
  transactions,
  categories,
}: {
  transactions: TransactionRow[];
  categories: CategoryRow[];
}) {
  const colors = categoryColors(categories);
  return (
    <section aria-label="Recent activity">
      <SectionHead
        title="Recent activity"
        action={
          <Link href="/transactions" className={HEAD_LINK}>
            All transactions
          </Link>
        }
      />
      {transactions.length === 0 ? (
        <p className="border-b border-line py-3.5 text-sm text-[var(--muted)]">
          No transactions yet. Hit Sync to bring them in.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <ul className="min-w-[520px]">
            {transactions.map((t) => (
              <li
                key={t.id}
                className="grid min-h-[46px] grid-cols-[56px_minmax(0,1.4fr)_minmax(0,1fr)_110px] items-center gap-4 border-b border-line"
              >
                <span className="mono text-xs text-[var(--muted)]">{shortDate(t.date)}</span>
                <span
                  className={`truncate text-sm font-medium ${t.isTransfer ? "text-[var(--muted)]" : ""}`}
                >
                  {t.displayName}
                </span>
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--muted)]">
                  <CategoryDot
                    id={t.categoryId ?? t.categoryName}
                    color={t.categoryId ? colors.get(t.categoryId) : null}
                  />
                  <span className="truncate">
                    {t.categoryName}
                    {t.splitCount > 0 && ` · ${t.splitCount} splits`}
                    {t.accountName && ` · ${t.accountName}`}
                  </span>
                </span>
                <Amount
                  amount={t.amount}
                  currency={t.currency}
                  quiet={t.isTransfer}
                  className="text-right text-sm"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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
  const flat = Math.abs(delta) < 0.005;
  return (
    <section aria-label="Spending review">
      <SectionHead
        title="Spending review"
        action={
          <Link href="/spending?view=trends" className={HEAD_LINK}>
            Full review
          </Link>
        }
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-3.5">
        <p className="min-w-0">
          <span className="eyebrow mr-3">{label}</span>
          <span className="font-display text-2xl tabular">
            <Figure value={formatCurrency(totals.expenses)} />
          </span>
        </p>
        <p className="text-[13px] text-[var(--muted)]">
          {flat ? (
            <>Level with {prevLabel}</>
          ) : (
            <>
              <span className={`mono ${up ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}>
                {up ? "+" : "−"}
                {formatCurrency(Math.abs(delta))} ({Math.abs(pct).toFixed(0)}%)
              </span>{" "}
              vs {prevLabel}
            </>
          )}
        </p>
      </div>

      {shifts.length > 0 && (
        <>
          <p className="pb-1 pt-3.5 text-xs text-[var(--muted)]">Biggest movers</p>
          <ul>
            {shifts.map((s) => {
              const more = s.delta > 0;
              return (
                <li
                  key={s.category}
                  className="flex min-h-[42px] items-center justify-between gap-3 border-b border-line text-sm"
                >
                  <span className="min-w-0 truncate">{s.category}</span>
                  <span
                    className={`mono shrink-0 ${more ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}
                  >
                    {more ? "+" : "−"}
                    {formatCurrency(Math.abs(s.delta))}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function TopVendorsList({
  merchants,
}: {
  merchants: { vendor: string; total: number; count: number }[];
}) {
  if (merchants.length === 0)
    return (
      <p className="-mt-4 border-b border-line py-3.5 text-sm text-[var(--muted)]">
        No vendors yet. Nothing recorded in this window.
      </p>
    );
  const max = Math.max(...merchants.map((m) => m.total));
  return (
    <ul className="-mt-4">
      {merchants.map((m) => (
        <li key={m.vendor} className="flex flex-col gap-2 border-b border-line py-3">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{m.vendor}</span>
            <span className="shrink-0">
              <span className="mono text-xs text-[var(--muted)]">{m.count}× </span>
              <span className="mono">{formatCurrency(m.total)}</span>
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
            <div
              className="h-full rounded-full bg-[var(--brass)]"
              style={{ width: `${max > 0 ? (m.total / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** How many budget lines Home lists before sending you to the full page. */
const BUDGET_ROWS = 5;

/** A thin progress bar with a tick where today falls in the month. */
function PaceBar({ used, elapsed, over }: { used: number; elapsed: number; over: boolean }) {
  return (
    <div className="relative h-1 rounded-full bg-[var(--panel-2)]">
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-[var(--coral)]" : "bg-[var(--jade)]"}`}
        style={{ width: `${Math.min(Math.max(used, 0), 1) * 100}%` }}
      />
      <span
        aria-hidden
        className="absolute -top-[3px] h-2.5 w-px bg-[var(--paper)]"
        style={{ left: `${Math.min(Math.max(elapsed, 0), 1) * 100}%` }}
      />
    </div>
  );
}

function BudgetsBody({
  summary,
  rows,
  pace,
}: {
  summary: BudgetSummary;
  rows: BudgetRow[];
  pace: MonthPace;
}) {
  const monthLabel = new Date(`${summary.month}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const none = summary.totalBudget <= 0;
  return (
    <section aria-label="Budgets">
      <SectionHead
        title="Budgets"
        action={
          <Link href="/budgets" className={HEAD_LINK}>
            {none ? "Set budgets" : `All ${rows.length}`}
          </Link>
        }
      />
      {none ? (
        <p className="border-b border-line py-3.5 text-sm text-[var(--muted)]">
          No budgets set. Set monthly limits to track against plan.
        </p>
      ) : (
        <>
          <BudgetLine
            name={monthLabel}
            budget={summary.totalBudget}
            spent={summary.totalSpent}
            elapsed={pace.elapsed}
            sub={`${formatCurrency(summary.totalSpent)} spent of ${formatCurrency(summary.totalBudget)} budgeted`}
          />
          {rows.slice(0, BUDGET_ROWS).map((r) => (
            <BudgetLine
              key={r.categoryId}
              name={r.name}
              budget={r.budget ?? 0}
              spent={r.spent}
              elapsed={pace.elapsed}
            />
          ))}
          <p className="mt-2.5 text-xs text-[var(--muted)]">
            {pace.daysLeft > 0
              ? `The tick on each bar is today, day ${pace.day} of ${pace.daysInMonth}.`
              : `${monthLabel} is finished, so the tick sits at the end of each bar.`}
          </p>
        </>
      )}
    </section>
  );
}

function BudgetLine({
  name,
  budget,
  spent,
  elapsed,
  sub,
}: {
  name: string;
  budget: number;
  spent: number;
  elapsed: number;
  sub?: string;
}) {
  const left = budget - spent;
  const over = left < 0;
  return (
    <div className="flex flex-col gap-2 border-b border-line py-3">
      <div className="flex justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">{name}</span>
        <span className="mono shrink-0 text-[13px]">
          <span className={over ? "text-[var(--coral)]" : undefined}>
            {formatCurrency(Math.abs(left))}
          </span>
          <span className="text-[var(--muted)]">{over ? " over" : " left"}</span>
        </span>
      </div>
      <PaceBar used={budget > 0 ? spent / budget : 0} elapsed={elapsed} over={over} />
      {sub && <p className="mono text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}
