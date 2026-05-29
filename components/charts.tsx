"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";

const PIE_COLORS = [
  "#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa",
  "#34d399", "#f87171", "#22d3ee", "#fb923c", "#c084fc",
];

const axis = { stroke: "#8b95a3", fontSize: 12 };

export function NetWorthChart({ data }: { data: { date: string; netWorth: number }[] }) {
  if (data.length === 0) return <Empty label="No snapshots yet — sync to start tracking." />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "MMM d")}
          tick={axis}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={axis}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [formatCurrency(Number(value)), "Net worth"]}
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Area type="monotone" dataKey="netWorth" stroke="#4ade80" strokeWidth={2} fill="url(#nw)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CashflowChart({
  data,
}: {
  data: { month: string; income: number; expenses: number }[];
}) {
  if (data.length === 0) return <Empty label="No transactions yet." />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
        <XAxis
          dataKey="month"
          tickFormatter={(m) => format(parseISO(m + "-01"), "MMM")}
          tick={axis}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatCompactCurrency(v)}
          tick={axis}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            formatCurrency(Number(value)),
            name === "income" ? "Income" : "Expenses",
          ]}
          labelFormatter={(m) => format(parseISO(m + "-01"), "MMMM yyyy")}
          cursor={{ fill: "#ffffff10" }}
        />
        <Bar dataKey="income" fill="#4ade80" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" fill="#f87171" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryChart({ data }: { data: { category: string; total: number }[] }) {
  if (data.length === 0) return <Empty label="No spending in this period." />;
  const top = data.slice(0, 10);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="w-full max-w-[220px]">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={top} dataKey="total" nameKey="category" innerRadius={55} outerRadius={90} paddingAngle={2}>
              {top.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full flex-1 space-y-1.5 text-sm">
        {top.map((d, i) => (
          <li key={d.category} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[var(--muted)]">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              {d.category}
            </span>
            <span className="tabular text-[var(--foreground)]">{formatCurrency(d.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const tooltipStyle = {
  background: "#1b2027",
  border: "1px solid #262c34",
  borderRadius: 8,
  fontSize: 12,
  color: "#e7ebf0",
};

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-[var(--muted)]">
      {label}
    </div>
  );
}
