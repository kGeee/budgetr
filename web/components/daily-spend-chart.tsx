"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";

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

export function DailySpendChart({
  data,
  selectedDate = null,
  onSelectDate,
}: {
  data: { date: string; spent: number }[];
  selectedDate?: string | null;
  onSelectDate?: (date: string | null) => void;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[140px] flex-col items-center justify-center gap-1 text-center">
        <p className="font-display text-base text-[var(--paper)]">No spending in the last 30 days</p>
      </div>
    );
  }

  const clickable = Boolean(onSelectDate);

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 6 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => format(parseISO(d), "MMM d")}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={20}
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
          labelFormatter={(d) => format(parseISO(d as string), "PP")}
        />
        <Bar
          dataKey="spent"
          radius={[3, 3, 0, 0]}
          maxBarSize={18}
          cursor={clickable ? "pointer" : undefined}
          onClick={
            onSelectDate
              ? (entry) => {
                  const date = (entry as { date?: string }).date;
                  if (date) onSelectDate(date === selectedDate ? null : date);
                }
              : undefined
          }
        >
          {data.map((d) => (
            <Cell
              key={d.date}
              fill={selectedDate && d.date !== selectedDate ? "#cbb07c55" : "#cbb07c"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
