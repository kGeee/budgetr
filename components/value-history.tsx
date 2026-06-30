"use client";

import { useMemo, useState } from "react";
import { ValueAreaChart } from "@/components/charts";
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

/**
 * Value-over-time tracker with selectable time windows (1M…All). Filters the
 * series client-side and shows the gain/loss over the chosen window. Shared by
 * the dashboard net-worth chart and the investments portfolio chart.
 */
export function ValueHistory({
  data,
  kind = "networth",
  height,
}: {
  data: ValuePoint[];
  kind?: keyof typeof KIND;
  height?: number;
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

  const filtered = useMemo(() => {
    if (active === "ALL" || data.length === 0) return data;
    const cutoff = new Date(data[data.length - 1].date);
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS[active]);
    const iso = cutoff.toISOString().slice(0, 10);
    return data.filter((d) => d.date >= iso);
  }, [data, active]);

  const first = filtered[0]?.value ?? 0;
  const last = filtered[filtered.length - 1]?.value ?? 0;
  const change = last - first;
  const pct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;
  const up = change >= 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
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

      <ValueAreaChart
        data={filtered}
        color={cfg.color}
        gradientId={cfg.gradientId}
        valueLabel={cfg.label}
        height={height}
        // Portfolio value swings are small relative to the total, so frame the
        // axis to the data instead of flattening it against a 0 baseline.
        baseline={kind === "portfolio" ? "auto" : "zero"}
      />
    </div>
  );
}
