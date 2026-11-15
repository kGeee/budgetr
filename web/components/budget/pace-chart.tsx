import { format, parseISO } from "date-fns";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";
import type { PaceSeries } from "@/lib/budget-verdict";

/**
 * Cumulative spend against an even burn of the budget, drawn straight on the
 * canvas: a three-label money gutter, the dashed even-pace diagonal, the spend
 * line with a faint fill, and a rule at today. Plain SVG so it stretches with
 * its column — strokes are non-scaling, so the lines stay hairline at any width.
 */

const W = 620;
const H = 200;
const TOP = 20;
const BASE = 180;

export function PaceChart({
  series,
  budget,
  label,
}: {
  series: PaceSeries;
  /** The limit the pace line climbs to; 0 draws spend alone. */
  budget: number;
  /** What is being charted, for the accessible description. */
  label: string;
}) {
  const { data, lastActualDay, daysInMonth, current, spentToDate, paceToDate, aheadOfPace } = series;
  const max = Math.max(budget, spentToDate, 1);
  const x = (day: number) => (daysInMonth > 1 ? ((day - 1) / (daysInMonth - 1)) * W : 0);
  const y = (v: number) => BASE - (v / max) * (BASE - TOP);

  const actual = data.slice(0, lastActualDay);
  const line = actual.map((p, i) => `${i === 0 ? "M" : "L"}${x(i + 1).toFixed(1)} ${y(p.spent ?? 0).toFixed(1)}`).join(" ");
  const todayX = x(lastActualDay);
  const stroke = aheadOfPace && budget > 0 ? "var(--coral)" : "var(--jade)";
  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;
  const todayDate = data[lastActualDay - 1]?.date;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-stretch gap-3">
        <div className="mono flex w-10 shrink-0 flex-col justify-between pb-3.5 pt-3 text-right text-[11px] text-[var(--muted)]">
          <span>{formatCompactCurrency(max)}</span>
          <span>{formatCompactCurrency(max / 2)}</span>
          <span>{formatCompactCurrency(0)}</span>
        </div>
        <svg
          role="img"
          aria-label={
            budget > 0
              ? `${label} reached ${formatCurrency(spentToDate)} by day ${lastActualDay}, against an even pace of ${formatCurrency(paceToDate)}`
              : `${label} reached ${formatCurrency(spentToDate)} by day ${lastActualDay}`
          }
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-[200px] min-w-0 flex-1"
        >
          <path d={`M0 ${BASE}H${W}`} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {current && (
            <path
              d={`M${todayX.toFixed(1)} ${TOP}V${BASE}`}
              stroke="var(--line-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {budget > 0 && (
            <path
              d={`M0 ${y(budget / daysInMonth).toFixed(1)} L${W} ${y(budget).toFixed(1)}`}
              fill="none"
              stroke="var(--muted)"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {actual.length > 0 && (
            <>
              <path d={`${line} L${todayX.toFixed(1)} ${BASE} L0 ${BASE}Z`} fill={stroke} fillOpacity={0.08} />
              <path
                d={line}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      </div>
      {first && last && (
        // Three fixed labels rather than one pinned to the today rule: at the
        // ends of the month a positioned label would collide with its neighbour.
        <div className="mono flex justify-between pl-[52px] text-[11px] text-[var(--muted)]">
          <span>{format(parseISO(first), "MMM d")}</span>
          {current && todayDate && lastActualDay > 1 && lastActualDay < daysInMonth && (
            <span className="text-[var(--paper)]" suppressHydrationWarning>
              Today, {format(parseISO(todayDate), "MMM d")}
            </span>
          )}
          <span>{format(parseISO(last), "MMM d")}</span>
        </div>
      )}
    </div>
  );
}
