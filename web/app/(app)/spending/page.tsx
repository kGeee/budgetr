import { differenceInCalendarDays, format, parseISO, startOfWeek, subDays, subMonths } from "date-fns";
import { AlertsPanel } from "@/components/alerts-panel";
import { IncompletePeriodNotice } from "@/components/data-freshness";
import { SpendingNav } from "@/components/spending/spending-nav";
import { SpendChartSwitch } from "@/components/spending/spend-chart-switch";
import {
  CategoryFocus,
  CategoryView,
  SpendingHero,
  TrendsView,
  type CategoryShift,
  type CategoryVsAverage,
} from "@/components/spending/period-views";
import { VendorView } from "@/components/spending/vendor-view";
import { ReportView } from "@/components/spending/report-view";
import type { SpendingView } from "@/components/spending/href";
import { detectAnomalies } from "@/lib/anomalies";
import { getDataHealthAlerts } from "@/lib/data-health";
import {
  getLatestTransactionDate,
  lastCompleteMonth,
  periodCoverage,
} from "@/lib/data-freshness";
import {
  getBiggestPurchases,
  getCategories,
  getCategoryById,
  getCategorySpendForPeriod,
  getDailySpendRange,
  getMonthlySpendForYear,
  getPeriodTotals,
  getTopMerchantsForPeriod,
  type CategoryDetail,
  type CategorySpend,
} from "@/lib/queries";
import { REPORT_PERIODS, resolvePeriod, type ReportPeriod } from "@/lib/report";

export const dynamic = "force-dynamic";

const VIEWS: SpendingView[] = ["category", "vendor", "trends"];
// Month periods compare against the three months before them; a year has only
// the one prior year worth comparing to.
const BASELINE_MONTHS = 3;

type SearchParams = {
  view?: string;
  period?: string;
  report?: string;
  category?: string;
  vendor?: string;
  /** Legacy /vendors?v= key, carried through by the redirect. */
  v?: string;
  currency?: string;
};

/** Per-category totals keyed by id (or name for uncategorized). */
const byKey = (rows: CategorySpend[]) =>
  new Map(rows.map((c) => [c.categoryId ?? c.category, c.total]));

/**
 * Spending — "where did my money go?". One period picker over three views
 * (by category, by vendor, trends), plus a printable report mode. Replaces the
 * separate Review, Report, Categories and Vendors pages.
 */
export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const explicit = REPORT_PERIODS.includes(sp.period as ReportPeriod);
  const period: ReportPeriod = explicit ? (sp.period as ReportPeriod) : "this-month";
  const explicitPeriod = explicit ? period : undefined;

  // Report mode renders the existing printable layout wholesale; it has its own
  // period tabs and masthead, and no app-side fallback (a report says what it's
  // asked for).
  if (sp.report === "1") {
    return <ReportView period={period} rawCurrency={sp.currency} />;
  }

  const view: SpendingView = VIEWS.includes(sp.view as SpendingView)
    ? (sp.view as SpendingView)
    : "category";

  if (view === "vendor") {
    return (
      <div className="space-y-9">
        <SpendingNav view={view} period={period} explicitPeriod={explicitPeriod} />
        <VendorView v={sp.vendor ?? sp.v} />
      </div>
    );
  }

  const now = new Date();
  let p = resolvePeriod(period, now);

  // The page's whole failure mode: reporting the current month with total
  // confidence when the sync stopped part-way through it, so "August: $1,959.85
  // across 4 transactions" reads as a quiet month rather than as missing data.
  //
  // An explicit period choice is always honoured — if you click "This month" you
  // get this month — but the default falls back to the last month the ledger
  // actually covers, and says so either way.
  const latestDate = getLatestTransactionDate();
  const coverage = periodCoverage(p.start, p.end, latestDate);
  const requestedLabel = p.label;
  let fellBack = false;

  if (!explicit && !coverage.complete) {
    const complete = lastCompleteMonth(latestDate);
    if (complete && complete !== p.start.slice(0, 7)) {
      p = resolvePeriod("this-month", new Date(`${complete}-01T00:00:00`));
      fellBack = true;
    }
  }

  // Either we fell back and must say which period is on screen and why, or the
  // period you explicitly asked for is short of data and must be labelled as
  // such. Both are the same banner; only the "showing X instead" clause differs.
  const banner = coverage.complete ? null : (
    <IncompletePeriodNotice
      requestedLabel={requestedLabel}
      shownLabel={fellBack ? p.label : requestedLabel}
      coverage={coverage}
    />
  );

  const totals = getPeriodTotals(p.start, p.end);
  const topVendors = getTopMerchantsForPeriod(p.start, p.end, 8);
  const categories = getCategorySpendForPeriod(p.start, p.end);
  const allCategories = getCategories();

  let body: React.ReactNode;
  let aside: React.ReactNode = null;
  let selected: CategoryDetail | null = null;
  if (view === "trends") {
    const prevCategories = getCategorySpendForPeriod(p.prevStart, p.prevEnd);

    // Category shifts vs the prior equal-length window. Biggest movers first,
    // in either direction.
    const prevByKey = byKey(prevCategories);
    const seen = new Set<string>();
    const shifts: CategoryShift[] = [
      ...categories.map((c) => {
        const key = c.categoryId ?? c.category;
        seen.add(key);
        const prev = prevByKey.get(key) ?? 0;
        return {
          categoryId: c.categoryId,
          category: c.category,
          icon: c.icon,
          current: c.total,
          prev,
          delta: c.total - prev,
        };
      }),
      // Categories that spent last period but not this one → full drop.
      ...prevCategories
        .filter((c) => !seen.has(c.categoryId ?? c.category))
        .map((c) => ({
          categoryId: c.categoryId,
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

    body = (
      <TrendsView
        label={p.label}
        prevLabel={p.prevLabel}
        topVendors={topVendors}
        biggest={getBiggestPurchases(p.start, p.end, 6)}
        shifts={shifts}
        monthlySpend={getMonthlySpendForYear(p.year)}
        year={p.year}
        periodSpend={getDailySpendRange(p.start, p.end)}
        periodStart={p.start}
        periodEnd={p.end}
        allCategories={allCategories}
      />
    );
  } else {
    // A category's spend only means something beside what it usually costs.
    // Months compare to the average of the three before; years to the prior year.
    const isYear = period === "this-year" || period === "last-year";
    const windows = isYear ? 1 : BASELINE_MONTHS;
    const baselineStart = isYear
      ? p.prevStart
      : format(subMonths(new Date(`${p.start}T00:00:00`), BASELINE_MONTHS), "yyyy-MM-dd");
    const baseline = byKey(getCategorySpendForPeriod(baselineStart, p.prevEnd));
    const rows: CategoryVsAverage[] = categories.map((c) => {
      const average = (baseline.get(c.categoryId ?? c.category) ?? 0) / windows;
      return { ...c, average, delta: average > 0 ? c.total / average - 1 : null };
    });

    selected = sp.category ? getCategoryById(sp.category) : null;

    // The same alerts Home leads with, so a price creep or a duplicate charge
    // is on the page where the spending is. Health first — a clear board only
    // reassures if the data behind it is complete.
    const alerts = [
      ...getDataHealthAlerts().filter((a) => a.key !== "health:review-backlog"),
      ...detectAnomalies(),
    ];

    // The chart beside the hero: the period day by day, or the trailing year
    // (Sunday-aligned so the calendar's columns are whole weeks).
    const heatEnd = format(now, "yyyy-MM-dd");
    const heatStart = format(startOfWeek(subDays(now, 364), { weekStartsOn: 0 }), "yyyy-MM-dd");
    aside = (
      <SpendChartSwitch
        daily={getDailySpendRange(p.start, p.end)}
        start={p.start}
        end={p.end}
        label={p.label}
        categories={allCategories}
        heatmap={{ data: getDailySpendRange(heatStart, heatEnd), start: heatStart, end: heatEnd }}
      />
    );

    body = (
      <CategoryView
        label={p.label}
        averageLabel={isYear ? p.prevLabel : `${BASELINE_MONTHS}-month average`}
        explicitPeriod={explicitPeriod}
        rows={rows}
        allCategories={allCategories}
        selectedId={selected?.id}
        topVendors={topVendors}
        biggest={getBiggestPurchases(p.start, p.end, 5)}
        insights={<AlertsPanel alerts={alerts} limit={3} compact />}
      />
    );
  }

  // How far through the period today is — only while the period is running.
  const today = format(now, "yyyy-MM-dd");
  const progress =
    today >= p.start && today <= p.end
      ? {
          elapsed: differenceInCalendarDays(parseISO(today), parseISO(p.start)) + 1,
          total: differenceInCalendarDays(parseISO(p.end), parseISO(p.start)) + 1,
        }
      : null;

  return (
    <div className="space-y-9">
      <SpendingNav view={view} period={period} explicitPeriod={explicitPeriod} />
      {banner}
      {selected ? (
        <CategoryFocus
          selected={selected}
          explicitPeriod={explicitPeriod}
          allCategories={allCategories}
        />
      ) : (
        <SpendingHero
          label={p.label}
          totals={totals}
          topVendor={topVendors[0]}
          progress={progress}
          aside={aside}
        />
      )}
      {body}
    </div>
  );
}
