"use client";

import { useMemo, useState } from "react";
import { BenchmarkLineChart, ValueAreaChart } from "@/components/charts";
import type { BenchmarkKey } from "@/lib/benchmark";
import type { PricePoint } from "@/lib/yahoo";
import { formatCurrency } from "@/lib/utils";

export type ValuePoint = { date: string; value: number };

type WindowKey = "1M" | "3M" | "6M" | "1Y" | "ALL";
const WINDOW_DAYS: Record<Exclude<WindowKey, "ALL">, number> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
};

const KIND = {
  networth: { color: "#6fe3a6", gradientId: "nwh", label: "Net worth" },
  portfolio: { color: "#cbb07c", gradientId: "pfh", label: "Value" },
} as const;

/** Sorted-series forward fill: the last close on/before `date`, or null. */
function closeAt(sorted: PricePoint[], date: string): number | null {
  let v: number | null = null;
  for (const p of sorted) {
    if (p.date <= date) v = p.close;
    else break;
  }
  return v;
}

/** Same forward fill for a {date,value} series (the TWR return index). */
function valueAt(sorted: ValuePoint[], date: string): number | null {
  let v: number | null = null;
  for (const p of sorted) {
    if (p.date <= date) v = p.value;
    else break;
  }
  return v;
}

/**
 * Value-over-time tracker with selectable time windows (1M…All). Filters the
 * series client-side and shows the gain/loss over the chosen window. Shared by
 * the dashboard net-worth chart and the investments portfolio chart.
 *
 * On the portfolio, an optional "vs SPY/QQQ" mode rebases the portfolio line to
 * 100 and overlays the benchmark closes (also rebased) for the active window.
 */
export function ValueHistory({
  data,
  portfolioReturnSeries,
  kind = "networth",
  height,
  benchmarks,
}: {
  data: ValuePoint[];
  /**
   * Time-weighted return index (base 100) for the benchmark overlay's portfolio
   * line. When present and the "vs SPY/QQQ" overlay is active, the portfolio is
   * drawn from this (deposits/withdrawals removed) instead of the raw market
   * value in `data` — so a deposit doesn't masquerade as outperformance. The
   * standalone "Value" mode always uses `data`.
   */
  portfolioReturnSeries?: ValuePoint[];
  kind?: keyof typeof KIND;
  height?: number;
  /** SPY/QQQ daily closes, enabling the benchmark-overlay toggle (portfolio only). */
  benchmarks?: Partial<Record<BenchmarkKey, PricePoint[]>>;
}) {
  const cfg = KIND[kind];

  // Only offer windows the data actually spans (plus All).
  const spanDays = useMemo(() => {
    if (data.length < 2) return 0;
    const a = new Date(data[0].date).getTime();
    const b = new Date(data[data.length - 1].date).getTime();
    return (b - a) / 86_400_000;
  }, [data]);

  const windows = useMemo<WindowKey[]>(() => {
    const ws = (["1M", "3M", "6M", "1Y"] as const).filter((w) => WINDOW_DAYS[w] < spanDays);
    return [...ws, "ALL"];
  }, [spanDays]);

  const [win, setWin] = useState<WindowKey>("ALL");
  const active = windows.includes(win) ? win : "ALL";

  // Benchmark overlay is only meaningful on the portfolio and when we actually
  // have SPY/QQQ closes to plot.
  const hasBenchmarks =
    kind === "portfolio" &&
    Boolean(benchmarks) &&
    ((benchmarks?.SPY?.length ?? 0) > 1 || (benchmarks?.QQQ?.length ?? 0) > 1);
  const [mode, setMode] = useState<"value" | "vs">("value");
  const vs = hasBenchmarks && mode === "vs";

  const filtered = useMemo(() => {
    if (active === "ALL" || data.length === 0) return data;
    const cutoff = new Date(data[data.length - 1].date);
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS[active]);
    const iso = cutoff.toISOString().slice(0, 10);
    return data.filter((d) => d.date >= iso);
  }, [data, active]);

  // Portfolio + benchmarks rebased to 100 at the window's first day, aligned
  // onto the portfolio's dates via forward fill (same approach as the series
  // reconstruction). Only built when the overlay is active.
  const rebased = useMemo(() => {
    if (!vs || filtered.length < 2) return [];
    const startDate = filtered[0].date;
    const spy = [...(benchmarks?.SPY ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const qqq = [...(benchmarks?.QQQ ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const spyBase = closeAt(spy, startDate);
    const qqqBase = closeAt(qqq, startDate);

    // Portfolio line: prefer the time-weighted return index (external deposits/
    // withdrawals already stripped out) so buying shares doesn't read as
    // appreciation against the cash-flow-free benchmarks. Fall back to raw
    // market value if the TWR series wasn't supplied.
    const twr =
      portfolioReturnSeries && portfolioReturnSeries.length > 1
        ? [...portfolioReturnSeries].sort((a, b) => a.date.localeCompare(b.date))
        : null;
    const pBase = (twr ? valueAt(twr, startDate) : filtered[0].value) || 1;

    return filtered.map((p) => {
      const pNow = twr ? valueAt(twr, p.date) : p.value;
      const spyNow = spyBase ? closeAt(spy, p.date) : null;
      const qqqNow = qqqBase ? closeAt(qqq, p.date) : null;
      return {
        date: p.date,
        portfolio: pNow != null ? (pNow / pBase) * 100 : 100,
        spy: spyNow != null && spyBase ? (spyNow / spyBase) * 100 : null,
        qqq: qqqNow != null && qqqBase ? (qqqNow / qqqBase) * 100 : null,
      };
    });
  }, [vs, filtered, benchmarks, portfolioReturnSeries]);

  const first = filtered[0]?.value ?? 0;
  const last = filtered[filtered.length - 1]?.value ?? 0;
  const change = last - first;
  const pct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;
  const up = change >= 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {filtered.length > 1 ? (
          <span className={`mono text-xs ${up ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}>
            {up ? "+" : "−"}
            {formatCurrency(Math.abs(change))} ({Math.abs(pct).toFixed(1)}%)
            <span className="ml-1 text-[var(--faint)]">
              {active === "ALL" ? "all time" : `past ${active}`}
            </span>
          </span>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {hasBenchmarks && (
            <div className="flex gap-1 rounded-lg border border-line bg-[var(--panel-2)] p-0.5">
              {(["value", "vs"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    mode === m
                      ? "bg-[var(--panel)] text-[var(--paper)]"
                      : "text-[var(--muted)] hover:text-[var(--paper)]"
                  }`}
                >
                  {m === "value" ? "Value" : "vs SPY/QQQ"}
                </button>
              ))}
            </div>
          )}

          {windows.length > 1 && (
            <div className="flex gap-1 rounded-lg border border-line bg-[var(--panel-2)] p-0.5">
              {windows.map((w) => (
                <button
                  key={w}
                  onClick={() => setWin(w)}
                  aria-pressed={active === w}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    active === w
                      ? "bg-[var(--panel)] text-[var(--paper)]"
                      : "text-[var(--muted)] hover:text-[var(--paper)]"
                  }`}
                >
                  {w === "ALL" ? "All" : w}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {vs ? (
        <BenchmarkLineChart data={rebased} height={height} />
      ) : (
        <ValueAreaChart
          data={filtered}
          color={cfg.color}
          gradientId={cfg.gradientId}
          valueLabel={cfg.label}
          height={height}
          // Value swings (portfolio and net worth alike) are small relative to
          // the total, so frame the axis to the data instead of flattening it
          // against a 0 baseline.
          baseline="auto"
        />
      )}
    </div>
  );
}
