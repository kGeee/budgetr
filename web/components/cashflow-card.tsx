"use client";

/**
 * "Income vs spending" card with a clickable month drill-down. The bar chart
 * drives a selected month (defaulting to the latest); selecting one reveals a
 * weekly income/spending breakdown and the underlying transactions for that
 * month. All figures use the same set the chart totals (see getCashflowBreakdown),
 * so the drill-down reconciles exactly with the bars.
 */

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CashflowChart } from "@/components/charts";
import { CategoryIcon } from "@/components/category-pill";
import { formatCurrency } from "@/lib/utils";
import type { CashflowTxn } from "@/lib/queries";

type MonthRow = { month: string; income: number; expenses: number };

// Day-of-month week buckets for the intra-month breakdown.
const WEEK_RANGES: [number, number][] = [
  [1, 7],
  [8, 14],
  [15, 21],
  [22, 28],
  [29, 31],
];

export function CashflowCard({
  data,
  breakdown,
}: {
  data: MonthRow[];
  breakdown: CashflowTxn[];
}) {
  const latest = data.length ? data[data.length - 1].month : null;
  const [selected, setSelected] = useState<string | null>(null);
  const month = selected ?? latest;

  const row = useMemo(() => data.find((d) => d.month === month) ?? null, [data, month]);
  const txns = useMemo(
    () => (month ? breakdown.filter((t) => t.month === month) : []),
    [breakdown, month],
  );
  const weeks = useMemo(() => buildWeeks(month, txns), [month, txns]);
  const net = row ? row.income - row.expenses : 0;
  const maxWeek = Math.max(1, ...weeks.map((w) => Math.max(w.income, w.expenses)));

  return (
    <Card className="lg:col-span-3 min-w-0">
      <CardHeader>
        <CardTitle>Income vs spending</CardTitle>
        {row && (
          <span className={`mono text-sm ${net >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}>
            {net >= 0 ? "+" : "−"}
            {formatCurrency(Math.abs(net))} in {format(parseISO(month + "-01"), "MMM")}
          </span>
        )}
      </CardHeader>

      <CashflowChart data={data} selectedMonth={selected} onSelectMonth={setSelected} />

      {month && row && (
        <div className="mt-4 border-t border-line/60 pt-4">
          <div className="flex items-center justify-between">
            <span className="eyebrow">{format(parseISO(month + "-01"), "MMMM yyyy")} breakdown</span>
            <span className="text-xs text-[var(--muted)]">
              <span className="text-[var(--jade)]">{formatCurrency(row.income)} in</span>
              {" · "}
              <span className="text-[var(--coral)]">{formatCurrency(row.expenses)} out</span>
            </span>
          </div>

          {/* Weekly breakdown */}
          <div className="mt-3 space-y-1.5">
            {weeks.map((w) => (
              <div key={w.label} className="flex items-center gap-3 text-xs">
                <span className="w-16 shrink-0 text-[var(--muted)]">{w.label}</span>
                <div className="flex h-3 flex-1 items-center gap-0.5">
                  <div
                    className="h-full rounded-sm bg-[var(--coral)]/70"
                    style={{ width: `${(w.expenses / maxWeek) * 100}%` }}
                    title={`${formatCurrency(w.expenses)} spent`}
                  />
                  <div
                    className="h-full rounded-sm bg-[var(--jade)]/70"
                    style={{ width: `${(w.income / maxWeek) * 100}%` }}
                    title={`${formatCurrency(w.income)} in`}
                  />
                </div>
                <span className="mono w-20 shrink-0 text-right text-[var(--coral)]">
                  {w.expenses > 0 ? `−${formatCurrency(w.expenses)}` : "—"}
                </span>
              </div>
            ))}
          </div>

          {/* Transactions */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="eyebrow">Transactions</span>
              <span className="text-xs text-[var(--muted)]">{txns.length}</span>
            </div>
            {txns.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--muted)]">
                No counted transactions this month.
              </p>
            ) : (
              <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
                {txns.map((t, i) => {
                  const expense = t.amount > 0;
                  return (
                    <li
                      key={`${t.id}:${i}`}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--panel-2)]/50"
                    >
                      <span className="w-9 shrink-0 mono text-[10px] text-[var(--faint)]">
                        {format(parseISO(t.date), "MMM d")}
                      </span>
                      <CategoryIcon icon={t.categoryIcon} size={13} className="shrink-0 text-[var(--muted)]" />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">
                        {t.categoryName ?? "Uncategorized"}
                      </span>
                      <span
                        className={`mono w-24 shrink-0 text-right ${expense ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}
                      >
                        {expense ? "−" : "+"}
                        {formatCurrency(Math.abs(t.amount))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

type Week = { label: string; income: number; expenses: number };

/** Bucket a month's transactions into day-of-month weeks with income/expense sums. */
function buildWeeks(month: string | null, txns: CashflowTxn[]): Week[] {
  if (!month) return [];
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monShort = format(parseISO(month + "-01"), "MMM");

  return WEEK_RANGES.filter(([lo]) => lo <= daysInMonth).map(([lo, hiRaw]) => {
    const hi = Math.min(hiRaw, daysInMonth);
    let income = 0;
    let expenses = 0;
    for (const t of txns) {
      const day = Number(t.date.slice(8, 10));
      if (day >= lo && day <= hi) {
        if (t.amount > 0) expenses += t.amount;
        else income += -t.amount;
      }
    }
    return { label: `${monShort} ${lo}–${hi}`, income, expenses };
  });
}
