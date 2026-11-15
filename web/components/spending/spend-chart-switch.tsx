"use client";

import { useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { PeriodSpendChart } from "@/components/budget/period-spend-chart";
import { SpendHeatmap } from "@/components/budget/spend-heatmap";
import type { CategoryRow } from "@/lib/queries";
import { segment, segmentGroup } from "./ruled";

/**
 * The chart beside the Spending hero: the chosen period day by day, or the
 * trailing year as a calendar. Both drill into a day's transactions on click.
 */
export function SpendChartSwitch({
  daily,
  start,
  end,
  label,
  categories,
  heatmap,
}: {
  daily: { date: string; spent: number }[];
  start: string;
  end: string;
  label: string;
  categories: CategoryRow[];
  heatmap: { data: { date: string; spent: number }[]; start: string; end: string };
}) {
  const [view, setView] = useState<"period" | "year">("period");
  // Past about two months the period chart buckets by week, and a week has no
  // single day to open.
  const drillable =
    view === "year" || differenceInCalendarDays(parseISO(end), parseISO(start)) <= 62;

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="eyebrow">
          {view === "period" ? `Daily spending · ${label}` : "Daily spending · trailing year"}
        </span>
        <div role="group" aria-label="Chart view" className={segmentGroup}>
          <button
            type="button"
            aria-pressed={view === "period"}
            onClick={() => setView("period")}
            className={`cursor-pointer ${segment(view === "period")}`}
          >
            Period
          </button>
          <button
            type="button"
            aria-pressed={view === "year"}
            onClick={() => setView("year")}
            className={`cursor-pointer ${segment(view === "year")}`}
          >
            Year heatmap
          </button>
        </div>
      </div>
      {view === "period" ? (
        <PeriodSpendChart
          data={daily}
          start={start}
          end={end}
          label={label}
          categories={categories}
        />
      ) : (
        <SpendHeatmap
          data={heatmap.data}
          start={heatmap.start}
          end={heatmap.end}
          categories={categories}
        />
      )}
      {drillable && (
        <p className="text-xs text-[var(--muted)]">Click a day to list its transactions.</p>
      )}
    </div>
  );
}
