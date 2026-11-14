"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Receipt,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryChart, MonthlySpendChart } from "@/components/charts";
import { CategoryIcon } from "@/components/budget/category-pill";
import { CategoryDetailPanel } from "@/components/budget/category-detail-panel";
import { PeriodSpendChart } from "@/components/budget/period-spend-chart";
import { formatMoney } from "@/lib/utils";
import type {
  BiggestPurchase,
  CategoryDetail,
  CategoryRow,
  CategorySpend,
  PeriodTotals,
  TopMerchant,
} from "@/lib/queries";
import { spendingHref } from "./href";

// USD is the ledger's storage currency; formatMoney converts to the user's
// display currency (or degrades to USD when no rates are cached). These views
// are client components for exactly that reason — the display currency and
// privacy mode live in client module state.
const money = (v: number) => formatMoney(v, "USD");

export type CategoryShift = {
  category: string;
  icon: string | null;
  current: number;
  prev: number;
  delta: number;
};

export type CategoryVsAverage = CategorySpend & {
  /** Per-period average over the comparison windows before this one. */
  average: number;
  /** total/average − 1, or null when there's no baseline. */
  delta: number | null;
};

/** The headline figure for the chosen period — shared by the category and trends views. */
export function SpendingHero({
  label,
  totals,
  topVendor,
}: {
  label: string;
  totals: PeriodTotals;
  topVendor?: TopMerchant;
}) {
  const empty = totals.txCount === 0;
  return (
    <Card className="rise overflow-hidden">
      <div className="flex items-center gap-2 text-[var(--brass)]">
        <Sparkles size={16} />
        <p className="eyebrow">{label}</p>
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
              <p className="display-1 mt-1.5 font-display text-5xl tabular sm:text-6xl">
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
  );
}

// ── By category ───────────────────────────────────────────────────────────────

export function CategoryView({
  label,
  averageLabel,
  explicitPeriod,
  rows,
  categories,
  allCategories,
  selected,
}: {
  label: string;
  /** What the average is taken over, e.g. "3-month average". */
  averageLabel: string;
  explicitPeriod?: string;
  rows: CategoryVsAverage[];
  categories: CategorySpend[];
  allCategories: CategoryRow[];
  selected: CategoryDetail | null;
}) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const max = rows.length > 0 ? rows[0].total : 0;
  const closeHref = spendingHref({ period: explicitPeriod });

  return (
    <>
      {/* The selected category's breakdown sits above the list rather than
          inline, so a deep link (?category=) lands on it without scrolling and
          works for categories with no spend in this period. */}
      {selected && (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-3 px-5 py-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--brass)]">
              <CategoryIcon icon={selected.icon} size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-display text-2xl">
                <span className="truncate">{selected.name}</span>
                {selected.archived && (
                  <span className="rounded-md border border-line px-2 py-0.5 text-xs text-[var(--faint)]">
                    Archived
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {money(selected.spent)} spent all time · {selected.count.toLocaleString()}{" "}
                transaction{selected.count === 1 ? "" : "s"}
              </p>
            </div>
            <Link
              href={closeHref}
              scroll={false}
              aria-label="Close category"
              className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
            >
              <X size={16} />
            </Link>
          </div>
          <CategoryDetailPanel
            key={selected.id}
            categoryId={selected.id}
            categories={allCategories}
            group={selected.group}
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>By category · {label}</CardTitle>
            <span className="text-xs text-[var(--faint)]">vs {averageLabel}</span>
          </CardHeader>
          {rows.length > 0 ? (
            <ul className="-mx-2 space-y-0.5">
              {rows.map((r) => {
                const share = total > 0 ? (r.total / total) * 100 : 0;
                const body = (
                  <>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <CategoryIcon icon={r.icon} />
                        <span className="truncate">{r.category}</span>
                        <span className="text-xs text-[var(--faint)]">{share.toFixed(0)}%</span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-3">
                        <Delta value={r.delta} />
                        <span className="mono tabular">{money(r.total)}</span>
                        {r.categoryId && (
                          <ChevronRight size={14} className="self-center text-[var(--faint)]" />
                        )}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
                      <div
                        className="h-full rounded-full bg-[var(--brass)]"
                        style={{ width: `${max > 0 ? Math.max(2, (r.total / max) * 100) : 0}%` }}
                      />
                    </div>
                  </>
                );
                const active = r.categoryId != null && r.categoryId === selected?.id;
                return (
                  <li key={r.categoryId ?? r.category}>
                    {/* Uncategorized has no id to open — it's a row, not a link. */}
                    {r.categoryId ? (
                      <Link
                        href={spendingHref({ period: explicitPeriod, category: r.categoryId })}
                        scroll={false}
                        aria-current={active ? "true" : undefined}
                        className={`block rounded-lg px-2 py-2 transition-colors hover:bg-[var(--panel-2)] ${
                          active ? "bg-[var(--panel-2)]" : ""
                        }`}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="px-2 py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Blank>No category spend in {label}.</Blank>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Where it went</CardTitle>
          </CardHeader>
          <CategoryChart data={categories} />
        </Card>
      </div>
    </>
  );
}

/** "+24%" against the category's own average, or nothing to compare to. */
function Delta({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-[var(--faint)]">new</span>;
  }
  // Inside ±5% of its own average is "normal" — labelling that a change is noise.
  if (Math.abs(value) < 0.05) {
    return <span className="text-xs text-[var(--faint)]">on avg</span>;
  }
  const up = value > 0;
  return (
    <span className={`text-xs tabular ${up ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}>
      {up ? "+" : "−"}
      {Math.abs(Math.round(value * 100))}%
    </span>
  );
}

// ── Trends ────────────────────────────────────────────────────────────────────

export function TrendsView({
  label,
  prevLabel,
  topVendors,
  biggest,
  shifts,
  monthlySpend,
  year,
  periodSpend,
  periodStart,
  periodEnd,
  allCategories,
}: {
  label: string;
  prevLabel: string;
  topVendors: TopMerchant[];
  biggest: BiggestPurchase[];
  shifts: CategoryShift[];
  monthlySpend: { month: string; spent: number }[];
  year: number;
  periodSpend: { date: string; spent: number }[];
  periodStart: string;
  periodEnd: string;
  allCategories: CategoryRow[];
}) {
  return (
    <>
      {/* Month-by-month for the period's calendar year. */}
      <Card>
        <CardHeader>
          <CardTitle>Month by month · {year}</CardTitle>
        </CardHeader>
        <MonthlySpendChart data={monthlySpend} />
      </Card>

      {/* Daily spend — scoped to the selected period. */}
      <Card>
        <CardHeader>
          <CardTitle>Daily spend · {label}</CardTitle>
          <CalendarDays size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <PeriodSpendChart
          data={periodSpend}
          start={periodStart}
          end={periodEnd}
          label={label}
          categories={allCategories}
        />
      </Card>

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
    </>
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
