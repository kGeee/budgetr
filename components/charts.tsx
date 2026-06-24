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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";

// Editorial palette: jade + brass anchored, harmonious cool/warm spread.
const PIE_COLORS = [
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
  boxShadow: "0 20px 40px -24px rgba(0,0,0,0.9)",
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
        <CartesianGrid stroke={GRID} vertical={false} />
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
        <CartesianGrid stroke={GRID} vertical={false} />
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

export function MonthlySpendChart({ data }: { data: { month: string; spent: number }[] }) {
  if (data.length === 0)
    return <Empty label="No spend in range" hint="Nothing recorded for this vendor yet." />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
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
        <Bar dataKey="spent" fill="#cbb07c" radius={[3, 3, 0, 0]} maxBarSize={30} />
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
        <CartesianGrid stroke={GRID} vertical={false} />
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

function Empty({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center">
      <p className="font-display text-base text-[var(--paper)]">{label}</p>
      <p className="text-sm text-[var(--muted)]">{hint}</p>
    </div>
  );
}
