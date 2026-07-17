import {
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfYear,
  subMonths,
  subYears,
} from "date-fns";
import { ReviewView } from "@/components/review-view";
import {
  getBiggestPurchases,
  getCategories,
  getCategorySpendForPeriod,
  getDailySpendRange,
  getMonthlySpendForYear,
  getPeriodTotals,
  getTopMerchantsForPeriod,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const PERIODS = ["this-month", "last-month", "this-year", "last-year"] as const;
type Period = (typeof PERIODS)[number];

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Resolve a period key to inclusive [start, end] bounds plus the immediately
 * preceding equal-length window (for category-shift deltas), a human label, and
 * the calendar year the month-by-month bar should chart.
 */
function resolvePeriod(period: Period, now: Date) {
  switch (period) {
    case "last-month": {
      const m = subMonths(now, 1);
      const prev = subMonths(m, 1);
      return {
        label: format(m, "MMMM yyyy"),
        prevLabel: format(prev, "MMMM"),
        start: iso(startOfMonth(m)),
        end: iso(endOfMonth(m)),
        prevStart: iso(startOfMonth(prev)),
        prevEnd: iso(endOfMonth(prev)),
        year: m.getFullYear(),
      };
    }
    case "this-year": {
      const prev = subYears(now, 1);
      return {
        label: format(now, "yyyy"),
        prevLabel: format(prev, "yyyy"),
        start: iso(startOfYear(now)),
        end: iso(endOfYear(now)),
        prevStart: iso(startOfYear(prev)),
        prevEnd: iso(endOfYear(prev)),
        year: now.getFullYear(),
      };
    }
    case "last-year": {
      const y = subYears(now, 1);
      const prev = subYears(now, 2);
      return {
        label: format(y, "yyyy"),
        prevLabel: format(prev, "yyyy"),
        start: iso(startOfYear(y)),
        end: iso(endOfYear(y)),
        prevStart: iso(startOfYear(prev)),
        prevEnd: iso(endOfYear(prev)),
        year: y.getFullYear(),
      };
    }
    case "this-month":
    default: {
      const prev = subMonths(now, 1);
      return {
        label: format(now, "MMMM yyyy"),
        prevLabel: format(prev, "MMMM"),
        start: iso(startOfMonth(now)),
        end: iso(endOfMonth(now)),
        prevStart: iso(startOfMonth(prev)),
        prevEnd: iso(endOfMonth(prev)),
        year: now.getFullYear(),
      };
    }
  }
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: raw } = await searchParams;
  const period: Period = PERIODS.includes(raw as Period) ? (raw as Period) : "this-month";

  const now = new Date();
  const p = resolvePeriod(period, now);

  // Day-level spend scoped to the selected period — the review page's daily-spend
  // chart follows the period tabs (daily bars for short spans, weekly beyond).
  const periodSpend = getDailySpendRange(p.start, p.end);
  const allCategories = getCategories();

  const totals = getPeriodTotals(p.start, p.end);
  const topVendors = getTopMerchantsForPeriod(p.start, p.end, 8);
  const biggest = getBiggestPurchases(p.start, p.end, 6);
  const categories = getCategorySpendForPeriod(p.start, p.end);
  const prevCategories = getCategorySpendForPeriod(p.prevStart, p.prevEnd);
  const monthlySpend = getMonthlySpendForYear(p.year);

  // Category shifts vs the prior equal-length window, keyed by category id (or
  // name for uncategorized). Biggest movers first, in either direction.
  const prevByKey = new Map(
    prevCategories.map((c) => [c.categoryId ?? c.category, c.total]),
  );
  const seen = new Set<string>();
  const shifts = [
    ...categories.map((c) => {
      const key = c.categoryId ?? c.category;
      seen.add(key);
      const prev = prevByKey.get(key) ?? 0;
      return { category: c.category, icon: c.icon, current: c.total, prev, delta: c.total - prev };
    }),
    // Categories that spent last period but not this one → full drop.
    ...prevCategories
      .filter((c) => !seen.has(c.categoryId ?? c.category))
      .map((c) => ({
        category: c.category,
        icon: c.icon,
        current: 0,
        prev: c.total,
        delta: -c.total,
      })),
  ]
    .filter((s) => s.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);

  return (
    <ReviewView
      period={period}
      label={p.label}
      prevLabel={p.prevLabel}
      totals={totals}
      topVendors={topVendors}
      biggest={biggest}
      categories={categories}
      shifts={shifts}
      monthlySpend={monthlySpend}
      year={p.year}
      periodSpend={periodSpend}
      periodStart={p.start}
      periodEnd={p.end}
      allCategories={allCategories}
    />
  );
}
