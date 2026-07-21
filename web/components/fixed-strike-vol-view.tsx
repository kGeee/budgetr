"use client";

/**
 * Fixed-strike vol view — IV pinned to strikes while spot moves. Two reads:
 *  - the GRID: strikes × capture days, each cell IV with its day-over-day
 *    change in vol points (coral = richened, jade = cheapened). This is the
 *    sheet that answers "did the surface actually reprice, or did spot just
 *    slide along the skew?"
 *  - the CHART: selected strikes' IV through time. Click grid rows to add or
 *    remove strikes.
 * History accumulates one column per day the options desk (or this page) is
 * opened — there is no backfill source, by design: it's your own tape.
 */

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { PIE_COLORS } from "@/components/charts";
import {
  buildFixedStrikeMatrix,
  changeAt,
  defaultStrikes,
  ivAt,
  strikeSeries,
  type IvSnapshotRow,
  type RightMode,
} from "@/lib/fixed-strike-vol-math";
import { formatStrike } from "@/lib/options";

const MODES: Array<{ key: RightMode; label: string }> = [
  { key: "otm", label: "OTM" },
  { key: "call", label: "Calls" },
  { key: "put", label: "Puts" },
];

const MAX_GRID_DATES = 10;
const NEAR_ATM_ROWS = 25;

export function FixedStrikeVolView({ ticker, rows }: { ticker: string; rows: IvSnapshotRow[] }) {
  // Expiries ranked by history depth, then nearness — the default is the one
  // you can actually read a time series from.
  const expiries = useMemo(() => {
    const byExpiry = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = byExpiry.get(r.expiry) ?? new Set<string>();
      set.add(r.date);
      byExpiry.set(r.expiry, set);
    }
    return [...byExpiry.entries()]
      .map(([expiry, dates]) => ({ expiry, days: dates.size }))
      .sort((a, b) => b.days - a.days || (a.expiry < b.expiry ? -1 : 1));
  }, [rows]);

  const [expiry, setExpiry] = useState<string | null>(null);
  const [mode, setMode] = useState<RightMode>("otm");
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<Set<number> | null>(null);

  const activeExpiry = expiry ?? expiries[0]?.expiry ?? null;
  const matrix = useMemo(
    () => (activeExpiry ? buildFixedStrikeMatrix(rows, activeExpiry, mode) : null),
    [rows, activeExpiry, mode],
  );

  if (!matrix || matrix.strikes.length === 0) {
    return (
      <Card>
        <span className="eyebrow">Fixed-strike vol</span>
        <p className="mt-3 max-w-lg text-sm text-[var(--muted)]">
          No IV snapshots yet for {ticker}. Open the options desk once and today&apos;s surface is
          captured; a new column appears each day you come back.
        </p>
      </Card>
    );
  }

  const dates = matrix.dates.slice(-MAX_GRID_DATES);
  const lastDate = matrix.dates[matrix.dates.length - 1]!;
  const spot = matrix.spotByDate.get(lastDate) ?? null;
  const atmStrike =
    spot == null
      ? null
      : [...matrix.strikes].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0] ?? null;

  const gridStrikes = showAll
    ? matrix.strikes
    : spot == null
      ? matrix.strikes.slice(0, NEAR_ATM_ROWS)
      : [...matrix.strikes]
          .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
          .slice(0, NEAR_ATM_ROWS)
          .sort((a, b) => b - a);

  const selected = picked ?? new Set(defaultStrikes(matrix, 5));
  const toggleStrike = (k: number) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else if (next.size < 8) next.add(k);
    setPicked(next);
  };

  // Chart data: one row per date, one key per selected strike.
  const chartStrikes = [...selected].sort((a, b) => b - a).filter((k) => matrix.strikes.includes(k));
  const chartData = matrix.dates.map((d) => {
    const point: Record<string, number | string | null> = { date: d.slice(5) };
    for (const k of chartStrikes) point[String(k)] = ivAt(matrix, k, d) != null ? ivAt(matrix, k, d)! * 100 : null;
    return point;
  });

  const singleDay = matrix.dates.length < 2;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Fixed-strike vol</span>
          {spot != null && (
            <span className="mono text-xs text-[var(--muted)]">
              spot {formatStrike(spot)} · {matrix.dates.length} {matrix.dates.length === 1 ? "day" : "days"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full border border-line p-0.5">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  mode === m.key ? "bg-[var(--jade)] text-[var(--on-jade)]" : "text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </span>
          <select
            value={activeExpiry ?? ""}
            onChange={(e) => setExpiry(e.target.value)}
            className="rounded-lg border border-line bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--paper)]"
          >
            {expiries.map((e) => (
              <option key={e.expiry} value={e.expiry}>
                {e.expiry} · {e.days}d history
              </option>
            ))}
          </select>
        </div>
      </div>

      {singleDay && (
        <p className="border-b border-line px-4 py-3 text-xs text-[var(--muted)] sm:px-6">
          One capture day so far — the grid fills out a column per day this page or the options desk
          is opened. Changes and the time chart light up from day two.
        </p>
      )}

      {!singleDay && chartStrikes.length > 0 && (
        <div className="border-b border-line px-2 pb-2 pt-4 sm:px-4">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={chartData} margin={{ top: 4, right: 18, bottom: 0, left: -14 }}>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--chart-tooltip-bg)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  fontSize: 12,
                }}
                formatter={(value, name) => [`${Number(value ?? 0).toFixed(1)}%`, formatStrike(Number(name))]}
              />
              {chartStrikes.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={String(k)}
                  stroke={PIE_COLORS[i % PIE_COLORS.length]}
                  strokeWidth={1.8}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="eyebrow sticky left-0 bg-[var(--panel)] px-4 py-2.5 sm:px-6">Strike</th>
              {dates.map((d) => (
                <th key={d} className="eyebrow px-3 py-2.5 text-right">
                  {d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gridStrikes.map((k) => {
              const isAtm = k === atmStrike;
              const inChart = selected.has(k);
              return (
                <tr
                  key={k}
                  onClick={() => toggleStrike(k)}
                  title="Click to toggle this strike on the chart"
                  className={`cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-[var(--panel-2)] ${
                    isAtm ? "bg-[var(--panel-2)]/60" : ""
                  }`}
                >
                  <td className={`mono sticky left-0 bg-[var(--panel)] px-4 py-2 sm:px-6 ${inChart ? "text-[var(--jade)]" : "text-[var(--brass)]"}`}>
                    {formatStrike(k)}
                    {isAtm && <span className="ml-1.5 text-[10px] text-[var(--muted)]">ATM</span>}
                  </td>
                  {dates.map((d) => {
                    const iv = ivAt(matrix, k, d);
                    const chg = changeAt(matrix, k, d);
                    return (
                      <td key={d} className="mono px-3 py-2 text-right">
                        {iv == null ? (
                          <span className="text-[var(--faint)]">—</span>
                        ) : (
                          <span className="inline-flex flex-col items-end leading-tight">
                            <span className="text-[var(--paper)]">{(iv * 100).toFixed(1)}</span>
                            {chg != null && Math.abs(chg) >= 0.05 && (
                              <span className={chg > 0 ? "text-[var(--coral)]" : "text-[var(--jade)]"}>
                                {chg > 0 ? "+" : ""}
                                {chg.toFixed(1)}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-6">
        <p className="text-[11px] text-[var(--muted)]">
          IV in vol points; small figure is the day-over-day change at that strike —{" "}
          <span className="text-[var(--coral)]">coral richened</span>,{" "}
          <span className="text-[var(--jade)]">jade cheapened</span>. Click rows to chart strikes.
        </p>
        {matrix.strikes.length > NEAR_ATM_ROWS && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] text-[var(--brass)] transition-colors hover:text-[var(--paper)]"
          >
            {showAll ? "Near ATM only" : `All ${matrix.strikes.length} strikes`}
          </button>
        )}
      </div>
    </Card>
  );
}
