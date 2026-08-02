"use client";

import { useMemo } from "react";
import { differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import { CategoriesSpendChart } from "@/components/categories-spend-chart";
import { DailySpendChart } from "@/components/daily-spend-chart";
import { formatMoney } from "@/lib/utils";
import type { CategoryRow } from "@/lib/queries";

// Daily bars up to ~two months; beyond that we bucket by week so a full year
// stays legible. Either way the chart fills the card width (no empty gutter).
const DAILY_MAX_DAYS = 62;

/**
 * Period-scoped spend chart for the review page. Given a day-level series over
 * the selected period, it renders daily bars for short spans (with a clickable
 * day drill-down) and weekly buckets for longer ones. Replaces the fixed
 * trailing-year heatmap, which left empty space on short lookbacks.
 */
export function PeriodSpendChart({
  data,
  start,
  end,
  label,
  categories,
}: {
  data: { date: string; spent: number }[];
  start: string;
  end: string;
  label: string;
  categories: CategoryRow[];
}) {
  const weekly = differenceInCalendarDays(parseISO(end), parseISO(start)) > DAILY_MAX_DAYS;

  const { series, total, busiest } = useMemo(() => {
    // Daily: use the series as-is. Weekly: bucket days into Sunday-anchored weeks.
    const source = weekly
      ? Array.from(
          data
            .reduce((m, d) => {
              const wk = format(startOfWeek(parseISO(d.date), { weekStartsOn: 0 }), "yyyy-MM-dd");
              m.set(wk, (m.get(wk) ?? 0) + d.spent);
              return m;
            }, new Map<string, number>())
            .entries(),
        )
          .map(([date, spent]) => ({ date, spent }))
          .sort((a, b) => a.date.localeCompare(b.date))
      : data;

    let total = 0;
    let busiest: { date: string; spent: number } | null = null;
    for (const d of source) {
      total += d.spent;
      if (!busiest || d.spent > busiest.spent) busiest = d;
    }
    return { series: source, total, busiest };
  }, [data, weekly]);

  const hasSpend = total > 0 && busiest != null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        {hasSpend ? (
          <>
            <span className="mono text-[var(--paper)]">{formatMoney(total, "USD")}</span> spent in{" "}
            {label} · busiest {weekly ? "week" : "day"} was{" "}
            <span className="text-[var(--paper)]">
              {weekly
                ? `week of ${format(parseISO(busiest!.date), "MMM d")}`
                : format(parseISO(busiest!.date), "MMM d")}
            </span>{" "}
            at <span className="mono text-[var(--paper)]">{formatMoney(busiest!.spent, "USD")}</span>.
          </>
        ) : (
          <>No spending in {label}.</>
        )}
      </p>

      {!hasSpend ? (
        <div className="flex h-[140px] items-center justify-center text-sm text-[var(--muted)]">
          Nothing recorded in {label}.
        </div>
      ) : weekly ? (
        // Weekly buckets: no per-day drill-down (a bar spans a week).
        <DailySpendChart data={series} />
      ) : (
        <CategoriesSpendChart daily={series} categories={categories} />
      )}
    </div>
  );
}
