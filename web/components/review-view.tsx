"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Receipt, Sparkles, Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHead } from "@/components/page-head";
import { CategoryChart, MonthlySpendChart } from "@/components/charts";
import { CategoryIcon } from "@/components/category-pill";
import { SpendHeatmap } from "@/components/spend-heatmap";
import { formatMoney } from "@/lib/utils";
import type {
  BiggestPurchase,
  CategoryRow,
  CategorySpend,
  PeriodTotals,
  TopMerchant,
} from "@/lib/queries";

type Period = "this-month" | "last-month" | "this-year" | "last-year";

type CategoryShift = {
  category: string;
  icon: string | null;
  current: number;
  prev: number;
  delta: number;
};

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-year", label: "This year" },
  { key: "last-year", label: "Last year" },
];

// USD is the ledger's storage currency; formatMoney converts to the user's
// display currency (or degrades to USD when no rates are cached).
const money = (v: number) => formatMoney(v, "USD");

export function ReviewView({
  period,
  label,
  prevLabel,
  totals,
  topVendors,
  biggest,
  categories,
  shifts,
  monthlySpend,
  year,
  heatmap,
  heatmapStart,
  heatmapEnd,
  allCategories,
}: {
  period: Period;
  label: string;
  prevLabel: string;
  totals: PeriodTotals;
  topVendors: TopMerchant[];
  biggest: BiggestPurchase[];
  categories: CategorySpend[];
  shifts: CategoryShift[];
  monthlySpend: { month: string; spent: number }[];
  year: number;
  heatmap: { date: string; spent: number }[];
  heatmapStart: string;
  heatmapEnd: string;
  allCategories: CategoryRow[];
}) {
  const empty = totals.txCount === 0;
  const topVendor = topVendors[0];

  return (
    <div className="space-y-7">
      <PageHead
        title="Review"
        action={
          <div className="flex flex-wrap gap-1.5">
            {PERIOD_TABS.map((t) => {
              const active = t.key === period;
              return (
                <Link
                  key={t.key}
                  href={`/review?period=${t.key}`}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                      : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        }
      />

      {/* Hero — the headline number for the chosen period. */}
      <Card className="rise overflow-hidden">
        <div className="flex items-center gap-2 text-[var(--brass)]">
          <Sparkles size={16} />
          <p className="eyebrow">{label} in review</p>
        </div>
        {empty ? (
          <p className="mt-4 text-[var(--muted)]">
            Nothing recorded for {label} yet. Sync or pick another period above.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm text-[var(--muted)]">Total spent</p>
                <p className="mt-1.5 font-display text-5xl leading-none tracking-tight tabular sm:text-6xl">
                  {money(totals.expenses)}
                </p>
                <p className="mt-3 text-sm text-[var(--muted)]">
                  across {totals.txCount.toLocaleString()} transaction
                  {totals.txCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex gap-8">
                <MiniStat label="Income" value={totals.income} tone="jade" />
                <span className="w-px self-stretch bg-line" />
                <MiniStat
                  label="Net"
                  value={totals.net}
                  tone={totals.net >= 0 ? "jade" : "coral"}
                  signed
                />
              </div>
            </div>
            {topVendor && (
              <p className="mt-6 border-t border-line pt-5 text-sm text-[var(--muted)]">
                Your top vendor was{" "}
                <span className="font-medium text-[var(--paper)]">{topVendor.vendor}</span> at{" "}
                <span className="mono text-[var(--paper)]">{money(topVendor.total)}</span> over{" "}
                {topVendor.count} visit{topVendor.count === 1 ? "" : "s"}.
              </p>
            )}
          </>
        )}
      </Card>

      {/* Daily-spend calendar — trailing year, period-independent. */}
      <Card>
        <CardHeader>
          <CardTitle>Daily spend · trailing year</CardTitle>
          <CalendarDays size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <SpendHeatmap
          data={heatmap}
          start={heatmapStart}
          end={heatmapEnd}
          categories={allCategories}
        />
      </Card>

      {/* Top vendors + biggest purchases */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top vendors</CardTitle>
            <Trophy size={15} className="text-[var(--brass)]" />
          </CardHeader>
          {topVendors.length > 0 ? (
            <ul className="space-y-1">
              {topVendors.map((v, i) => (
                <li
                  key={v.vendor}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--panel-2)]"
                >
                  <span className="mono w-5 shrink-0 text-center text-xs text-[var(--muted)]">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{v.vendor}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {v.count} transaction{v.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="mono shrink-0 text-sm text-[var(--paper)]">{money(v.total)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Blank>No vendor spend in this period.</Blank>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Biggest purchases</CardTitle>
            <Receipt size={15} className="text-[var(--brass)]" />
          </CardHeader>
          {biggest.length > 0 ? (
            <ul className="space-y-1">
              {biggest.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--panel-2)]"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-[var(--brass)]">
                    <CategoryIcon icon={b.categoryIcon} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.vendor}</p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {b.categoryName} · {format(parseISO(b.date), "MMM d")}
                    </p>
                  </div>
                  <span className="mono shrink-0 text-sm text-[var(--paper)]">{money(b.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Blank>No purchases in this period.</Blank>
          )}
        </Card>
      </div>

      {/* Category shifts vs prior period */}
      <Card>
        <CardHeader>
          <CardTitle>Category shifts · vs {prevLabel}</CardTitle>
        </CardHeader>
        {shifts.length > 0 ? (
          <ul className="divide-y divide-line/60">
            {shifts.map((s) => {
              const up = s.delta >= 0;
              const pct = s.prev > 0 ? (s.delta / s.prev) * 100 : null;
              return (
                <li key={s.category} className="flex items-center gap-3 py-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-[var(--brass)]">
                    <CategoryIcon icon={s.icon} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.category}</p>
                    <p className="mono text-xs text-[var(--muted)]">
                      {money(s.prev)} → {money(s.current)}
                    </p>
                  </div>
                  <span
                    className={`mono inline-flex shrink-0 items-center gap-1 text-sm ${
                      up ? "text-[var(--coral)]" : "text-[var(--jade)]"
                    }`}
                  >
                    {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {up ? "+" : "−"}
                    {money(Math.abs(s.delta))}
                    {pct != null && (
                      <span className="text-[var(--muted)]">({Math.abs(pct).toFixed(0)}%)</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Blank>No category changes to compare against {prevLabel}.</Blank>
        )}
      </Card>

      {/* Month-by-month spend + category mix */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Month by month · {year}</CardTitle>
          </CardHeader>
          <MonthlySpendChart data={monthlySpend} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Where it went</CardTitle>
          </CardHeader>
          <CategoryChart data={categories} />
        </Card>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
  signed = false,
}: {
  label: string;
  value: number;
  tone: "jade" | "coral" | "paper";
  signed?: boolean;
}) {
  const cls =
    tone === "jade" ? "text-[var(--jade)]" : tone === "coral" ? "text-[var(--coral)]" : "";
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1.5 font-display text-2xl tabular ${cls}`}>
        {signed ? (value >= 0 ? "+" : "−") : ""}
        {money(Math.abs(value))}
      </p>
    </div>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-[var(--muted)]">{children}</p>;
}
