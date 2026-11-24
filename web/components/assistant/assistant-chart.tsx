"use client";

/**
 * Draws a validated ChartSpec with the app's own chart vocabulary (Recharts,
 * the same palette, grid and tooltip as components/charts.tsx). Every value
 * goes through formatCurrency, so privacy mode masks these figures too.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { PIE_COLORS } from "@/components/charts";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";
import type { ChartSpec, ChartUnit, SeriesChartSpec, TableChartSpec } from "@/lib/assistant/chart-spec";

const GRID = "var(--chart-grid)";
const tick = { fill: "var(--muted)", fontSize: 10.5, fontFamily: "var(--font-mono)" };
const tooltipStyle = {
  background: "var(--chart-tooltip-bg)",
  border: "1px solid var(--line-strong)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--paper)",
  padding: "8px 12px",
  fontFamily: "var(--font-mono)",
};

export function formatValue(v: number, unit: ChartUnit, compact = false): string {
  if (unit === "currency") return compact ? formatCompactCurrency(v) : formatCurrency(v);
  if (unit === "percent") return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  return v.toLocaleString("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  });
}

/** "2026-03" → "Mar 26", "2026-03-14" → "Mar 14"; anything else as given. */
export function shortLabel(label: string): string {
  try {
    if (/^\d{4}-\d{2}$/.test(label)) return format(parseISO(`${label}-01`), "MMM yy");
    if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return format(parseISO(label), "MMM d");
  } catch {
    // fall through
  }
  return label;
}

export function AssistantChart({ spec }: { spec: ChartSpec }) {
  return (
    <figure className="rounded-xl border border-line bg-[var(--ink)] p-3">
      <figcaption className="mb-2">
        <div className="text-[13px] font-medium text-[var(--paper)]">{spec.title}</div>
        {spec.subtitle && <div className="text-[11.5px] text-[var(--muted)]">{spec.subtitle}</div>}
      </figcaption>
      {spec.type === "table" ? <SpecTable spec={spec} /> : <SpecSeries spec={spec} />}
    </figure>
  );
}

function SpecSeries({ spec }: { spec: SeriesChartSpec }) {
  const data = spec.labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    spec.series.forEach((s, j) => (row[`s${j}`] = s.values[i]));
    return row;
  });
  const valueFmt = (v: unknown) => formatValue(Number(v), spec.unit);
  const multi = spec.series.length > 1;

  if (spec.type === "pie") {
    const slices = spec.labels.map((label, i) => ({ label, value: spec.series[0].values[i] }));
    return (
      <div className="flex items-center gap-3">
        <div className="w-[140px] shrink-0">
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius={40}
                outerRadius={66}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={valueFmt} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="min-w-0 flex-1 space-y-1 text-[12px]">
          {slices.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[var(--muted)]">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="mono shrink-0 tabular">{formatValue(s.value, spec.unit)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const colorOf = (j: number) => PIE_COLORS[j % PIE_COLORS.length];
  const common = {
    data,
    margin: { left: 0, right: 6, top: 6, bottom: 0 },
  };
  const axes = (
    <>
      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
      <XAxis
        dataKey="label"
        tickFormatter={shortLabel}
        tick={tick}
        tickLine={false}
        axisLine={{ stroke: GRID }}
        minTickGap={12}
      />
      <YAxis
        tickFormatter={(v) => formatValue(Number(v), spec.unit, true)}
        tick={tick}
        tickLine={false}
        axisLine={false}
        width={52}
      />
      <Tooltip
        contentStyle={tooltipStyle}
        labelStyle={{ color: "var(--muted)" }}
        itemStyle={{ color: "var(--muted)" }}
        cursor={{ fill: "rgba(127,127,127,0.06)" }}
        labelFormatter={(l) => shortLabel(String(l))}
        formatter={(v, name) => [valueFmt(v), spec.series[Number(String(name).slice(1))]?.name ?? name]}
      />
      {multi && (
        <Legend
          formatter={(name) => spec.series[Number(String(name).slice(1))]?.name ?? name}
          wrapperStyle={{ fontSize: 11, color: "var(--muted)" }}
          iconSize={8}
        />
      )}
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={200}>
      {spec.type === "line" ? (
        <LineChart {...common}>
          {axes}
          {spec.series.map((_, j) => (
            <Line
              key={j}
              dataKey={`s${j}`}
              stroke={colorOf(j)}
              strokeWidth={2}
              dot={spec.labels.length <= 24}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart {...common} barGap={3}>
          {axes}
          {spec.series.map((_, j) => (
            <Bar
              key={j}
              dataKey={`s${j}`}
              fill={colorOf(j)}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

function SpecTable({ spec }: { spec: TableChartSpec }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {spec.columns.map((c, i) => (
              <th
                key={i}
                className={`sticky top-0 border-b border-line bg-[var(--ink)] px-2 py-1.5 font-medium text-[var(--muted)] ${
                  i === 0 ? "text-left" : "text-right"
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`px-2 py-1.5 ${
                    typeof cell === "number" ? "mono tabular text-right" : j === 0 ? "text-left" : "text-right"
                  }`}
                >
                  {typeof cell === "number" ? formatValue(cell, spec.unit) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
