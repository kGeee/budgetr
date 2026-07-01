"use client";

import {
  Activity,
  BarChart3,
  CalendarDays,
  PieChart,
  Store,
  Target,
  type LucideIcon,
} from "lucide-react";
import { CashflowChart, CategoryChart, NetWorthChart } from "@/components/charts";
import { SpendHeatmap } from "@/components/spend-heatmap";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { CategoryRow, WidgetData, WidgetType } from "@/lib/queries";

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
};

export const WIDGET_TYPES = Object.keys(WIDGET_META) as WidgetType[];

/** Renders one resolved widget inside a Card, dispatching on its data `type`. */
export function DashboardWidget({
  data,
  categories,
}: {
  data: WidgetData;
  categories: CategoryRow[];
}) {
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
  }
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
