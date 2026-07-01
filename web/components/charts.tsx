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
  "#6fe3a6", "#cbb07c", "#7fb2e0", "#f0897b", "#b59ce0",
  "#5fc9c0", "#e0c36f", "#9ad17f", "#e08fb8", "#8b948c",
];

const GRID = "#212a27";
const tick = { fill: "#8b948c", fontSize: 11, fontFamily: "var(--font-mono)" };

const tooltipStyle = {
  background: "#101413",
  border: "1px solid #303b37",
  borderRadius: 12,
  fontSize: 12,
  color: "#ece7da",
  padding: "8px 12px",
  boxShadow: "0 30px 60px -32px rgba(0,0,0,0.9)",
  fontFamily: "var(--font-mono)",
};
const labelStyle = { color: "#8b948c", marginBottom: 2 };

export function NetWorthChart({ data }: { data: { date: string; netWorth: number }[] }) {
  if (data.length === 0)
    return <Empty label="No snapshots yet" hint="Sync to begin charting your net worth." />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6fe3a6" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#6fe3a6" stopOpacity={0} />
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
          cursor={{ stroke: "#cbb07c", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value) => [formatCurrency(Number(value)), "Net worth"]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Area
          type="monotone"
          dataKey="netWorth"
          stroke="#6fe3a6"
          strokeWidth={2.5}
          fill="url(#nw)"
          activeDot={{ r: 4, fill: "#6fe3a6", stroke: "#090c0b", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CashflowChart({
  data,
}: {
  data: { month: string; income: number; expenses: number }[];
}) {
  if (data.length === 0) return <Empty label="No activity yet" hint="Connect an account to see cashflow." />;
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
        <Bar dataKey="income" fill="#6fe3a6" radius={[3, 3, 0, 0]} maxBarSize={26} />
        <Bar dataKey="expenses" fill="#f0897b" radius={[3, 3, 0, 0]} maxBarSize={26} />
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
              fill={selectedMonth && d.month !== selectedMonth ? "#cbb07c66" : "#cbb07c"}
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
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative w-full max-w-[200px] shrink-0">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={top}
              dataKey="total"
              nameKey="category"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={2.5}
              stroke="none"
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
      <ul className="w-full flex-1 space-y-2 text-sm">
        {top.map((d, i) => (
          <li key={d.category} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5 text-[var(--muted)]">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <span className="truncate">{d.category}</span>
            </span>
            <span className="mono shrink-0 text-[var(--paper)]">{formatCurrency(d.total)}</span>
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
            <stop offset="0%" stopColor="#cbb07c" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#cbb07c" stopOpacity={0} />
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
          cursor={{ stroke: "#cbb07c", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value) => [formatCurrency(Number(value)), "Value"]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#cbb07c"
          strokeWidth={2.5}
          fill="url(#pf)"
          activeDot={{ r: 4, fill: "#cbb07c", stroke: "#090c0b", strokeWidth: 2 }}
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
  color = "#cbb07c",
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
          domain={baseline === "auto" ? ["auto", "auto"] : undefined}
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
          activeDot={{ r: 4, fill: color, stroke: "#090c0b", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
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
  const spendColor = over ? "#f0897b" : "#6fe3a6";
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
          cursor={{ stroke: "#cbb07c", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value, name) => [
            value == null ? "—" : formatCurrency(Number(value)),
            name === "pace" ? "Budget pace" : "Spent",
          ]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Line
          type="monotone"
          dataKey="pace"
          stroke="#8b948c"
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
          cursor={{ stroke: "#cbb07c", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value, name) => [
            value == null ? "—" : formatCurrency(Number(value)),
            name === "actual" ? "Actual" : "Projected",
          ]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        {today && (
          <ReferenceLine
            x={today}
            stroke="#8b948c"
            strokeDasharray="3 3"
            label={{ value: "Today", position: "insideTopRight", fill: "#8b948c", fontSize: 10 }}
          />
        )}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="#6fe3a6"
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          stroke="#cbb07c"
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
  const color = up ? "#6fe3a6" : "#f0897b";
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
          cursor={{ stroke: "#cbb07c", strokeWidth: 1, strokeDasharray: "3 3" }}
          formatter={(value, name) => [
            formatCurrency(Number(value)),
            name === "buy" ? "Buy" : name === "sell" ? "Sell" : "Close",
          ]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Line
          type="monotone"
          dataKey="close"
          stroke="#cbb07c"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="buy"
          stroke="transparent"
          strokeWidth={0}
          legendType="none"
          dot={{ r: 4, fill: "#6fe3a6", stroke: "#090c0b", strokeWidth: 1.5 }}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          dataKey="sell"
          stroke="transparent"
          strokeWidth={0}
          legendType="none"
          dot={{ r: 4, fill: "#f0897b", stroke: "#090c0b", strokeWidth: 1.5 }}
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
        fill="#8b948c"
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
