"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";
import { format, parseISO } from "date-fns";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";

// Editorial palette: jade + brass anchored, harmonious cool/warm spread.
export const PIE_COLORS = [
  "var(--jade)", "var(--brass)", "var(--blue)", "var(--coral)", "#b59ce0",
  "#5fc9c0", "#e0c36f", "#9ad17f", "#e08fb8", "var(--muted)",
];

const GRID = "var(--chart-grid)";
const tick = { fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" };

/**
 * A Y-axis domain framed to the data with ~8% headroom on each side, so a line
 * whose swings are small next to its absolute level (net worth, portfolio value)
 * reads as real movement instead of a flat line pinned to a 0 baseline. Falls
 * back to a sensible band when the series is empty or perfectly flat, and never
 * forces 0 into view, so negative balances frame correctly too.
 */
function framedDomain(values: number[]): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const range = hi - lo;
  const pad = range > 0 ? range * 0.08 : Math.max(Math.abs(hi) * 0.08, 1);
  return [lo - pad, hi + pad];
}

const tooltipStyle = {
  background: "var(--chart-tooltip-bg)",
  border: "1px solid var(--line-strong)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--paper)",
  padding: "8px 12px",
  boxShadow: "0 30px 60px -32px rgba(0,0,0,0.9)",
  fontFamily: "var(--font-mono)",
};
const labelStyle = { color: "var(--muted)", marginBottom: 2 };

export function NetWorthChart({ data }: { data: { date: string; netWorth: number }[] }) {
  if (data.length === 0)
    return <Empty label="No snapshots yet" hint="Sync to begin charting your net worth." />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--jade)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--jade)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "MMM d")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={58}
          domain={framedDomain(data.map((d) => d.netWorth))}
          allowDataOverflow={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ stroke: "var(--brass)", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value) => [formatCurrency(Number(value)), "Net worth"]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Area
          type="monotone"
          dataKey="netWorth"
          stroke="var(--jade)"
          strokeWidth={2.5}
          fill="url(#nw)"
          isAnimationActive={false}
          activeDot={{ r: 4, fill: "var(--jade)", stroke: "var(--chart-dot-stroke)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CashflowChart({
  data,
  selectedMonth = null,
  onSelectMonth,
}: {
  data: { month: string; income: number; expenses: number }[];
  /** Highlighted month ('YYYY-MM') when the chart drives a drill-down. */
  selectedMonth?: string | null;
  /** Called with the clicked month, or null when the active bar is clicked again. */
  onSelectMonth?: (month: string | null) => void;
}) {
  if (data.length === 0) return <Empty label="No activity yet" hint="Connect an account to see cashflow." />;
  const clickable = Boolean(onSelectMonth);
  const handleClick = onSelectMonth
    ? (entry: unknown) => {
        const month = (entry as { payload?: { month?: string } })?.payload?.month;
        if (month) onSelectMonth(month === selectedMonth ? null : month);
      }
    : undefined;
  const dim = (month: string, base: string) =>
    selectedMonth && month !== selectedMonth
      ? `color-mix(in srgb, ${base} 40%, transparent)`
      : base;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }} barGap={4}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={(m) => format(parseISO(m + "-01"), "MMM")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={58}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(value, name) => [
            formatCurrency(Number(value)),
            name === "income" ? "Income" : "Expenses",
          ]}
          labelFormatter={(m) => format(parseISO(m + "-01"), "MMMM yyyy")}
        />
        <Bar
          dataKey="income"
          radius={[3, 3, 0, 0]}
          maxBarSize={26}
          isAnimationActive={false}
          cursor={clickable ? "pointer" : undefined}
          onClick={handleClick}
        >
          {data.map((d) => (
            <Cell key={d.month} fill={dim(d.month, "var(--jade)")} />
          ))}
        </Bar>
        <Bar
          dataKey="expenses"
          radius={[3, 3, 0, 0]}
          maxBarSize={26}
          isAnimationActive={false}
          cursor={clickable ? "pointer" : undefined}
          onClick={handleClick}
        >
          {data.map((d) => (
            <Cell key={d.month} fill={dim(d.month, "var(--coral)")} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MonthlySpendChart({
  data,
  selectedMonth = null,
  onSelectMonth,
}: {
  data: { month: string; spent: number }[];
  /** Highlighted month ('YYYY-MM'), when the chart drives a filter. */
  selectedMonth?: string | null;
  /** Called with the clicked month, or null when the active bar is clicked again. */
  onSelectMonth?: (month: string | null) => void;
}) {
  if (data.length === 0)
    return <Empty label="No spend in range" hint="Nothing recorded for this vendor yet." />;
  const clickable = Boolean(onSelectMonth);
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={(m) => format(parseISO(m + "-01"), "MMM")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={6}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(value) => [formatCurrency(Number(value)), "Spent"]}
          labelFormatter={(m) => format(parseISO(m + "-01"), "MMMM yyyy")}
        />
        <Bar
          dataKey="spent"
          radius={[3, 3, 0, 0]}
          maxBarSize={30}
          isAnimationActive={false}
          cursor={clickable ? "pointer" : undefined}
          onClick={
            onSelectMonth
              ? (entry) => {
                  const month = (entry as { payload?: { month?: string } })?.payload?.month;
                  if (month) onSelectMonth(month === selectedMonth ? null : month);
                }
              : undefined
          }
        >
          {data.map((d) => (
            <Cell
              key={d.month}
              fill={
                selectedMonth && d.month !== selectedMonth
                  ? "color-mix(in srgb, var(--brass) 40%, transparent)"
                  : "var(--brass)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryChart({ data }: { data: { category: string; total: number }[] }) {
  if (data.length === 0) return <Empty label="No spending" hint="Nothing recorded in this window." />;
  const top = data.slice(0, 8);
  const total = top.reduce((s, d) => s + d.total, 0);
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-6 sm:flex-row sm:gap-8">
      <div className="relative w-full max-w-[190px] shrink-0">
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <Pie
              data={top}
              dataKey="total"
              nameKey="category"
              innerRadius={60}
              outerRadius={88}
              paddingAngle={2.5}
              stroke="none"
              isAnimationActive={false}
            >
              {top.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => formatCurrency(Number(value))}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="eyebrow">Total</span>
          <span className="font-display text-lg text-[var(--paper)] tabular">
            {formatCompactCurrency(total)}
          </span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2 text-sm sm:max-w-[260px]">
        {top.map((d, i) => (
          <li key={d.category} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2.5 text-[var(--muted)]">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <span className="truncate">{d.category}</span>
            </span>
            <span className="mono shrink-0 tabular text-[var(--paper)]">{formatCurrency(d.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PortfolioChart({ data }: { data: { date: string; value: number }[] }) {
  if (data.length === 0)
    return (
      <Empty
        label="No price history yet"
        hint="Historical closes load from Yahoo Finance for your tickers."
      />
    );
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="pf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brass)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--brass)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "MMM d")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={58}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ stroke: "var(--brass)", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value) => [formatCurrency(Number(value)), "Value"]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--brass)"
          strokeWidth={2.5}
          fill="url(#pf)"
          isAnimationActive={false}
          activeDot={{ r: 4, fill: "var(--brass)", stroke: "var(--chart-dot-stroke)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Generic value-over-time area chart over `{ date, value }`. Backs both the
 * net-worth and portfolio history trackers (via ValueHistory's window tabs).
 */
export function ValueAreaChart({
  data,
  color = "var(--brass)",
  gradientId = "val",
  valueLabel = "Value",
  height = 280,
  baseline = "zero",
}: {
  data: { date: string; value: number }[];
  color?: string;
  gradientId?: string;
  valueLabel?: string;
  height?: number;
  /**
   * Y-axis floor. "zero" anchors the axis at 0 (good when absolute scale
   * matters); "auto" frames the axis to the data's range so day-to-day
   * movement is legible instead of being flattened against a 0 baseline.
   */
  baseline?: "zero" | "auto";
}) {
  if (data.length === 0)
    return <Empty label="No history yet" hint="Sync to begin charting this over time." />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "MMM d")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={58}
          domain={baseline === "auto" ? framedDomain(data.map((d) => d.value)) : undefined}
          allowDataOverflow={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value) => [formatCurrency(Number(value)), valueLabel]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          activeDot={{ r: 4, fill: color, stroke: "var(--chart-dot-stroke)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Rebased-to-100 comparison line colors, shared by chart + legend. */
const BENCHMARK_LINES = [
  { key: "portfolio", label: "Portfolio", color: "var(--brass)" },
  { key: "spy", label: "SPY", color: "var(--blue)" },
  { key: "qqq", label: "QQQ", color: "#b59ce0" },
] as const;

/**
 * Portfolio vs benchmark overlay: every series rebased to 100 at the window's
 * start so their *shapes* are comparable regardless of absolute scale. Portfolio
 * is brass; SPY/QQQ ride cooler hues. Benchmark lines only draw when present.
 */
export function BenchmarkLineChart({
  data,
  height = 280,
}: {
  data: { date: string; portfolio: number; spy: number | null; qqq: number | null }[];
  height?: number;
}) {
  if (data.length < 2)
    return <Empty label="No history yet" hint="Sync to compare against SPY and QQQ." />;

  // Only legend/plot benchmarks that actually carry data in this window.
  const present = BENCHMARK_LINES.filter(
    (l) => l.key === "portfolio" || data.some((d) => d[l.key] != null),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {present.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <span className="inline-block h-2 w-3 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-[var(--faint)]">indexed to 100 at window start</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d) => format(parseISO(d), "MMM d")}
            tick={tick}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v) => Number(v).toFixed(0)}
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={40}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={labelStyle}
            cursor={{ stroke: "var(--brass)", strokeWidth: 1, strokeDasharray: "3 3" }}
            formatter={(value, name) => {
              const line = BENCHMARK_LINES.find((l) => l.key === name);
              const v = Number(value);
              const pct = v - 100;
              return [`${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`, line?.label ?? name];
            }}
            labelFormatter={(d) => format(parseISO(d as string), "PP")}
          />
          {present.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              stroke={l.color}
              strokeWidth={l.key === "portfolio" ? 2.5 : 1.75}
              dot={false}
              connectNulls
              isAnimationActive={false}
              activeDot={{ r: 4, fill: l.color, stroke: "var(--chart-dot-stroke)", strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Cumulative spend for the month against a straight budget-pace line (0 → total
 * budget). Spend line is jade when on/under pace, coral when ahead of it.
 */
export function BudgetPaceChart({
  data,
  over,
}: {
  data: { date: string; spent: number | null; pace: number }[];
  over: boolean;
}) {
  if (data.length === 0)
    return <Empty label="No budget set" hint="Set category budgets to track pace." />;
  const spendColor = over ? "var(--coral)" : "var(--jade)";
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "d")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={16}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ stroke: "var(--brass)", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value, name) => [
            value == null ? "—" : formatCurrency(Number(value)),
            name === "pace" ? "Budget pace" : "Spent",
          ]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Line
          type="monotone"
          dataKey="pace"
          stroke="var(--muted)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="spent"
          stroke={spendColor}
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Actual-vs-projected end-of-month cash balance. The solid jade line is the
 * reconstructed balance up to today; the dashed brass line projects forward
 * (pace spend + scheduled bills/income). A reference line marks today, where the
 * two series meet. Y-axis auto-frames so the projected drawdown stays legible.
 */
export function ForecastChart({
  data,
  today = null,
}: {
  data: { date: string; actual: number | null; projected: number | null }[];
  /** 'YYYY-MM-DD' of today within the charted month, or null for a past month. */
  today?: string | null;
}) {
  if (data.length === 0)
    return <Empty label="No forecast yet" hint="Connect a cash account to project your month." />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "MMM d")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={58}
          domain={["auto", "auto"]}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ stroke: "var(--brass)", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value, name) => [
            value == null ? "—" : formatCurrency(Number(value)),
            name === "actual" ? "Actual" : "Projected",
          ]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        {today && (
          <ReferenceLine
            x={today}
            stroke="var(--muted)"
            strokeDasharray="3 3"
            label={{ value: "Today", position: "insideTopRight", fill: "var(--muted)", fontSize: 10 }}
          />
        )}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="var(--jade)"
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          stroke="var(--brass)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Net-worth history (solid jade `actual`) continued by a compounding forward
 * projection (dashed brass `projected`) toward the FIRE number, marked with a
 * horizontal reference line. The two lines meet at today's point. Reuses the
 * ValueAreaChart axis/tooltip idiom on a dual-line chart. Years span decades, so
 * the X axis is formatted as years.
 */
export function FireProjectionChart({
  data,
  fireNumber,
}: {
  data: { date: string; actual: number | null; projected: number | null }[];
  fireNumber: number;
}) {
  if (data.length === 0)
    return <Empty label="No projection yet" hint="Sync accounts and set your FIRE assumptions." />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "yyyy")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={58}
          domain={["auto", "auto"]}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ stroke: "var(--brass)", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value, name) => [
            value == null ? "—" : formatCurrency(Number(value)),
            name === "actual" ? "Net worth" : "Projected",
          ]}
          labelFormatter={(d) => format(parseISO(d as string), "MMM yyyy")}
        />
        {fireNumber > 0 && (
          <ReferenceLine
            y={fireNumber}
            stroke="var(--jade)"
            strokeDasharray="4 4"
            label={{
              value: `FIRE ${formatCompactCurrency(fireNumber)}`,
              position: "insideTopLeft",
              fill: "var(--jade)",
              fontSize: 10,
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="var(--jade)"
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          stroke="var(--brass)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Tiny inline price trend; green when up over the window, coral when down. */
export function Sparkline({
  data,
  width = 92,
  height = 26,
}: {
  data: { date: string; close: number }[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const up = data[data.length - 1].close >= data[0].close;
  const color = up ? "var(--jade)" : "var(--coral)";
  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Line
          type="monotone"
          dataKey="close"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

type TickerTrade = {
  date: string;
  quantity: number | null;
  price: number | null;
  type: string | null;
};

/**
 * Full price history for one ticker with the user's buy/sell trades marked.
 * Trades are snapped to the nearest trading day at/under their date so the
 * markers always align to a point on the (category) x-axis. Markers are drawn
 * as zero-width lines so only their dots show.
 */
export function TickerPriceChart({
  data,
  trades = [],
}: {
  data: { date: string; close: number }[];
  trades?: TickerTrade[];
}) {
  if (data.length < 2)
    return <Empty label="No price history" hint="Yahoo Finance had no closes for this ticker." />;

  const dates = data.map((d) => d.date);
  // Snap a trade date to the latest trading day on or before it (else the first).
  const snap = (date: string): string => {
    let chosen = dates[0];
    for (const d of dates) {
      if (d <= date) chosen = d;
      else break;
    }
    return chosen;
  };

  const closeByDate = new Map(data.map((d) => [d.date, d.close]));
  const buyAt = new Map<string, number>();
  const sellAt = new Map<string, number>();
  for (const t of trades) {
    if (!t.quantity) continue;
    const key = snap(t.date);
    const y = t.price && t.price > 0 ? t.price : (closeByDate.get(key) ?? 0);
    const isBuy = t.type === "buy" || t.quantity > 0;
    (isBuy ? buyAt : sellAt).set(key, y);
  }

  const merged = data.map((d) => ({
    date: d.date,
    close: d.close,
    buy: buyAt.get(d.date) ?? null,
    sell: sellAt.get(d.date) ?? null,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={merged} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "MMM d")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={56}
          domain={["auto", "auto"]}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          cursor={{ stroke: "var(--brass)", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value, name) => [
            formatCurrency(Number(value)),
            name === "buy" ? "Buy" : name === "sell" ? "Sell" : "Close",
          ]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Line
          type="monotone"
          dataKey="close"
          stroke="var(--brass)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="buy"
          stroke="transparent"
          strokeWidth={0}
          legendType="none"
          dot={{ r: 4, fill: "var(--jade)", stroke: "var(--chart-dot-stroke)", strokeWidth: 1.5 }}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          dataKey="sell"
          stroke="transparent"
          strokeWidth={0}
          legendType="none"
          dot={{ r: 4, fill: "var(--coral)", stroke: "var(--chart-dot-stroke)", strokeWidth: 1.5 }}
          isAnimationActive={false}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export type SectorSlice = {
  sector: string;
  value: number;
  count: number;
  /** Stable color shared across the donut, bar chart, and breakdown panel. */
  color: string;
};

/**
 * Allocation donut: one slice per sector, each labelled with its name and % of
 * the portfolio. Clicking a slice drives the drill-down filter; the active
 * sector is emphasized while the rest dim. Colors are supplied by the caller so
 * they stay in lockstep with the ranking bars and the breakdown list.
 */
export function AllocationDonut({
  data,
  total,
  activeSector = null,
  onSelect,
}: {
  data: SectorSlice[];
  total: number;
  activeSector?: string | null;
  onSelect?: (sector: string | null) => void;
}) {
  if (data.length === 0)
    return <Empty label="No sectors yet" hint="Tag a holding's sector to chart your allocation." />;

  const renderLabel = (props: PieLabelRenderProps) => {
    // recharts types these loosely (number | string | undefined); coerce.
    const cx = Number(props.cx ?? 0);
    const cy = Number(props.cy ?? 0);
    const midAngle = Number(props.midAngle ?? 0);
    const outerRadius = Number(props.outerRadius ?? 0);
    const percent = Number(props.percent ?? 0);
    const payload = (props as { payload?: SectorSlice }).payload;
    if (!payload || percent < 0.04) return null; // skip slivers — they'd overlap
    const RAD = Math.PI / 180;
    const r = outerRadius + 14;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    const anchor = x >= cx ? "start" : "end";
    return (
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={11}
        fontFamily="var(--font-mono)"
        fill="var(--muted)"
      >
        {payload.sector} · {(percent * 100).toFixed(0)}%
      </text>
    );
  };

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative mx-auto w-full max-w-[280px] shrink-0">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="sector"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={2.5}
              stroke="none"
              isAnimationActive={false}
              labelLine={false}
              label={renderLabel}
              onClick={
                onSelect
                  ? (entry) => {
                      const s = (entry as { payload?: SectorSlice })?.payload?.sector;
                      if (s) onSelect(s === activeSector ? null : s);
                    }
                  : undefined
              }
            >
              {data.map((d) => (
                <Cell
                  key={d.sector}
                  fill={d.color}
                  fillOpacity={activeSector && d.sector !== activeSector ? 0.32 : 1}
                  cursor={onSelect ? "pointer" : undefined}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [
                `${formatCurrency(Number(value))} · ${total ? ((Number(value) / total) * 100).toFixed(1) : "0"}%`,
                "",
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="eyebrow">{activeSector ?? "Total"}</span>
          <span className="font-display text-lg text-[var(--paper)] tabular">
            {formatCompactCurrency(
              activeSector
                ? data.find((d) => d.sector === activeSector)?.value ?? 0
                : total,
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Sectors ranked by dollar value, largest at top. Horizontal bars so long
 * sector names read cleanly; clicking a bar drives the same drill-down filter
 * as the donut.
 */
export function SectorBarChart({
  data,
  activeSector = null,
  onSelect,
}: {
  data: SectorSlice[];
  activeSector?: string | null;
  onSelect?: (sector: string | null) => void;
}) {
  if (data.length === 0) return null;
  const ranked = [...data].sort((a, b) => b.value - a.value);
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, ranked.length * 38)}>
      <BarChart
        data={ranked}
        layout="vertical"
        margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          type="category"
          dataKey="sector"
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={96}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(value) => [formatCurrency(Number(value)), "Value"]}
        />
        <Bar
          dataKey="value"
          radius={[0, 3, 3, 0]}
          maxBarSize={22}
          isAnimationActive={false}
          cursor={onSelect ? "pointer" : undefined}
          onClick={
            onSelect
              ? (entry) => {
                  const s = (entry as { payload?: SectorSlice })?.payload?.sector;
                  if (s) onSelect(s === activeSector ? null : s);
                }
              : undefined
          }
        >
          {ranked.map((d) => (
            <Cell
              key={d.sector}
              fill={d.color}
              fillOpacity={activeSector && d.sector !== activeSector ? 0.32 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Empty({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center">
      <p className="font-display text-base text-[var(--paper)]">{label}</p>
      <p className="text-sm text-[var(--muted)]">{hint}</p>
    </div>
  );
}
