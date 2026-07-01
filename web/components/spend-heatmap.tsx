"use client";

import { useEffect, useMemo, useState } from "react";
import {
  eachDayOfInterval,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";
import { X } from "lucide-react";
import { TransactionsTable } from "@/components/transactions-table";
import { getTransactionsForDate } from "@/lib/actions";
import { formatMoney } from "@/lib/utils";
import type { CategoryRow, TransactionRow } from "@/lib/queries";

// Cell + gap geometry. Kept in JS so the month-label track lines up with the
// week columns exactly (one label slot per column).
const CELL = 12;
const GAP = 3;
const COL = CELL + GAP;

// Intensity ramp: level 0 = a day with no spend, 1→4 = quantile buckets from a
// muted panel tint up to full brass. color-mix blends brass over --panel-2 so
// the scale reads on the dark paper the same way the rest of the app does.
const LEVELS = [
  "var(--panel-2)",
  "color-mix(in srgb, var(--brass) 22%, var(--panel-2))",
  "color-mix(in srgb, var(--brass) 45%, var(--panel-2))",
  "color-mix(in srgb, var(--brass) 68%, var(--panel-2))",
  "color-mix(in srgb, var(--brass) 92%, var(--panel-2))",
];

const WEEKDAYS = ["", "Mon", "", "Wed", "", "Fri", ""];

type Day = { date: string; spent: number; level: number };

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.floor((sorted.length - 1) * q);
  return sorted[i];
}

export function SpendHeatmap({
  data,
  start,
  end,
  categories,
}: {
  // `start` is expected to already fall on a Sunday so the grid is week-aligned.
  data: { date: string; spent: number }[];
  start: string;
  end: string;
  categories: CategoryRow[];
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [txns, setTxns] = useState<TransactionRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const { weeks, months, total, maxDay } = useMemo(() => {
    const spentByDate = new Map(data.map((d) => [d.date, d.spent]));

    // Quantile thresholds over the days that actually had spend.
    const values = data.map((d) => d.spent).filter((v) => v > 0).sort((a, b) => a - b);
    const t1 = quantile(values, 0.25);
    const t2 = quantile(values, 0.5);
    const t3 = quantile(values, 0.75);
    const level = (v: number) =>
      v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4;

    const gridStart = startOfWeek(parseISO(start), { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start: gridStart, end: parseISO(end) });

    const cells: Day[] = days.map((d) => {
      const iso = format(d, "yyyy-MM-dd");
      const spent = spentByDate.get(iso) ?? 0;
      return { date: iso, spent, level: level(spent) };
    });

    // Chunk into 7-day columns (Sunday → Saturday).
    const weeks: Day[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    // One month label per column where the month first changes.
    const months: { label: string; col: number }[] = [];
    let lastMonth = "";
    weeks.forEach((w, col) => {
      const m = w[0].date.slice(0, 7);
      if (m !== lastMonth) {
        months.push({ label: format(parseISO(w[0].date), "MMM"), col });
        lastMonth = m;
      }
    });

    let total = 0;
    let maxDay: Day | null = null;
    for (const c of cells) {
      total += c.spent;
      if (!maxDay || c.spent > maxDay.spent) maxDay = c;
    }

    return { weeks, months, total, maxDay };
  }, [data, start, end]);

  useEffect(() => {
    if (!selectedDate) {
      setTxns(null);
      return;
    }
    let active = true;
    setLoading(true);
    getTransactionsForDate(selectedDate)
      .then((rows) => {
        if (active) {
          setTxns(rows);
          setLoading(false);
        }
      })
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [selectedDate]);

  if (data.length === 0) {
    return (
      <div className="flex h-[160px] flex-col items-center justify-center gap-1 text-center">
        <p className="font-display text-base text-[var(--paper)]">
          No spending in the last year
        </p>
        <p className="text-sm text-[var(--muted)]">
          Sync an account to light up the calendar.
        </p>
      </div>
    );
  }

  const gridWidth = weeks.length * COL - GAP;

  return (
    <div className="space-y-4">
      {maxDay && maxDay.spent > 0 && (
        <p className="text-sm text-[var(--muted)]">
          <span className="mono text-[var(--paper)]">{formatMoney(total, "USD")}</span> spent
          over the trailing year · busiest day was{" "}
          <span className="text-[var(--paper)]">
            {format(parseISO(maxDay.date), "MMM d")}
          </span>{" "}
          at <span className="mono text-[var(--paper)]">{formatMoney(maxDay.spent, "USD")}</span>.
        </p>
      )}

      <div className="overflow-x-auto pb-1">
        <div className="flex gap-2" style={{ width: 28 + gridWidth }}>
          {/* Weekday labels down the side. */}
          <div
            className="flex shrink-0 flex-col text-[10px] text-[var(--muted)]"
            style={{ width: 20, gap: GAP, paddingTop: 18 }}
          >
            {WEEKDAYS.map((d, i) => (
              <div key={i} style={{ height: CELL, lineHeight: `${CELL}px` }}>
                {d}
              </div>
            ))}
          </div>

          <div>
            {/* Month labels track — one slot per week column. */}
            <div className="relative" style={{ height: 16, width: gridWidth }}>
              {months.map((m) => (
                <span
                  key={`${m.label}-${m.col}`}
                  className="absolute top-0 text-[10px] text-[var(--muted)]"
                  style={{ left: m.col * COL }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            {/* Week columns. */}
            <div className="flex" style={{ gap: GAP }}>
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                  {week.map((day) => {
                    const inWindow = day.date >= start && day.date <= end;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() =>
                          setSelectedDate((prev) => (prev === day.date ? null : day.date))
                        }
                        title={`${
                          day.spent > 0 ? formatMoney(day.spent, "USD") : "No spending"
                        } · ${format(parseISO(day.date), "EEE, MMM d, yyyy")}`}
                        aria-label={`${format(parseISO(day.date), "PP")}: ${
                          day.spent > 0 ? formatMoney(day.spent, "USD") : "no spending"
                        }`}
                        className={`rounded-[3px] transition-[outline] hover:outline hover:outline-1 hover:outline-[var(--brass)] ${
                          selectedDate === day.date
                            ? "outline outline-1 outline-[var(--paper)]"
                            : ""
                        } ${inWindow ? "" : "opacity-40"}`}
                        style={{
                          width: CELL,
                          height: CELL,
                          background: LEVELS[day.level],
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend. */}
      <div className="flex items-center justify-end gap-1.5 text-[10px] text-[var(--muted)]">
        <span>Less</span>
        {LEVELS.map((bg, i) => (
          <span
            key={i}
            className="rounded-[3px]"
            style={{ width: CELL, height: CELL, background: bg }}
          />
        ))}
        <span>More</span>
      </div>

      {/* Day drill-down. */}
      {selectedDate && (
        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <p className="eyebrow">{format(parseISO(selectedDate), "MMMM d, yyyy")}</p>
            <button
              onClick={() => setSelectedDate(null)}
              className="rounded-full p-0.5 text-[var(--faint)] transition hover:text-[var(--paper)]"
              aria-label="Clear selected day"
            >
              <X size={13} />
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          ) : txns && txns.length > 0 ? (
            <TransactionsTable transactions={txns} categories={categories} />
          ) : (
            <p className="text-sm text-[var(--muted)]">No transactions on this day.</p>
          )}
        </div>
      )}
    </div>
  );
}
