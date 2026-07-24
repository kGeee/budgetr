import type { PricePoint } from "@/lib/yahoo";

/**
 * Benchmark comparison — measure the reconstructed portfolio's return against
 * SPY / QQQ over each time window. Pure functions, no I/O: the benchmark closes
 * are fetched upstream via getTickerHistories (which rides the 6h Yahoo Data
 * Cache) and handed in here already resolved.
 *
 * Everything aligns on the *portfolio's* dates using the same forward-fill
 * approach buildReconstructedSeries uses — a benchmark's last-known close is
 * carried forward across days it doesn't quote, so a missing trading day never
 * drops a series out of the window.
 */

export type ValuePoint = { date: string; value: number };
/** A value point carrying the day's external cash flow (deposit +, withdrawal −). */
export type FlowPoint = { date: string; value: number; flow: number };
export type BenchmarkKey = "SPY" | "QQQ";

/** Time windows we compare over. YTD anchors to Jan 1 of the latest year. */
export type WindowKey = "1M" | "3M" | "6M" | "1Y" | "YTD";
export const BENCHMARK_WINDOWS: WindowKey[] = ["1M", "3M", "6M", "1Y", "YTD"];

const WINDOW_MONTHS: Record<Exclude<WindowKey, "YTD">, number> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
};

/** One row of the out/under-performance table. `null` = window not spanned. */
export type ComparisonRow = {
  window: WindowKey;
  portfolioPct: number | null;
  spyPct: number | null;
  qqqPct: number | null;
  /** portfolioPct − spyPct (positive = outperformed SPY). */
  deltaVsSpy: number | null;
  deltaVsQqq: number | null;
};

/** A benchmark's daily closes as a value series. */
export function toValueSeries(points: PricePoint[] | undefined): ValuePoint[] {
  return (points ?? []).map((p) => ({ date: p.date, value: p.close }));
}

/**
 * Rebase a series so its first point sits at 100 — lets a portfolio worth
 * $250k and an ETF worth $470/share share one axis on the overlay chart.
 */
export function normalizeToBase100(series: ValuePoint[]): ValuePoint[] {
  if (series.length === 0) return [];
  const base = series[0].value;
  if (!base) return series.map((p) => ({ date: p.date, value: 100 }));
  return series.map((p) => ({ date: p.date, value: (p.value / base) * 100 }));
}

/**
 * Time-weighted return index (base 100) from a value+flow series.
 *
 * TWR strips the effect of external deposits/withdrawals so the result reflects
 * only how the *investments* performed — making it apples-to-apples with an
 * index like SPY that has no cash flows. On a day you buy shares, market value
 * steps up purely from deposited capital; naively taking value(t)/value(t−1)
 * would book that deposit as a gain. TWR backs the flow out first:
 *
 *   dailyReturn = (value_t − flow_t) / value_{t-1} − 1
 *   index_t     = index_{t-1} × (1 + dailyReturn)
 *
 * Days where the prior value is ≤ 0 (the portfolio was empty — e.g. the first
 * funding day, or a full liquidation followed by a re-buy) contribute no return
 * and simply re-anchor the base: there was no capital at risk to earn on, so the
 * running index carries forward unchanged rather than dividing by zero.
 */
export function twrIndexSeries(series: FlowPoint[]): ValuePoint[] {
  if (series.length === 0) return [];
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  let index = 100;
  const out: ValuePoint[] = [{ date: sorted[0].date, value: index }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    const cur = sorted[i];
    if (prev > 0) {
      const dailyReturn = (cur.value - cur.flow) / prev - 1;
      index *= 1 + dailyReturn;
    }
    // prev ≤ 0 → no capital at risk yesterday; today's funding isn't a return,
    // so the index is unchanged and effectively re-anchors from here.
    out.push({ date: cur.date, value: index });
  }
  return out;
}

/** Sorted-series forward fill: the last value on/before `date`, or null. */
function valueAt(sorted: ValuePoint[], date: string): number | null {
  let v: number | null = null;
  for (const p of sorted) {
    if (p.date <= date) v = p.value;
    else break;
  }
  return v;
}

/** Window's start date (YYYY-MM-DD) relative to the series' latest date. */
function windowStart(endDate: string, win: WindowKey): string {
  if (win === "YTD") return `${endDate.slice(0, 4)}-01-01`;
  const d = new Date(`${endDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - WINDOW_MONTHS[win]);
  return d.toISOString().slice(0, 10);
}

/** Percent return between two dates, forward-filling both endpoints. */
function returnBetween(
  sorted: ValuePoint[],
  startDate: string,
  endDate: string,
): number | null {
  const a = valueAt(sorted, startDate);
  const b = valueAt(sorted, endDate);
  if (a == null || b == null || a === 0) return null;
  return (b / a - 1) * 100;
}

/**
 * Percent return of `series` over `win`, anchored to the series' own latest
 * date. Returns null when the window reaches before the series begins.
 */
export function windowReturn(series: ValuePoint[], win: WindowKey): number | null {
  if (series.length < 2) return null;
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const endDate = sorted[sorted.length - 1].date;
  // Nothing on/before the window start → we can't honestly report the window.
  if (sorted[0].date > windowStart(endDate, win)) return null;
  return returnBetween(sorted, windowStart(endDate, win), endDate);
}

/**
 * Portfolio vs SPY/QQQ across every window. All three series are measured over
 * the *portfolio's* window endpoints (its latest date back to the window start)
 * so the comparison is apples-to-apples; each benchmark forward-fills onto those
 * same endpoints. Windows the portfolio doesn't span are dropped.
 */
export function computeComparison(
  portfolioSeries: ValuePoint[],
  benchmarks: Partial<Record<BenchmarkKey, PricePoint[]>>,
): ComparisonRow[] {
  if (portfolioSeries.length < 2) return [];
  const pSorted = [...portfolioSeries].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = pSorted[0].date;
  const endDate = pSorted[pSorted.length - 1].date;

  const spy = [...toValueSeries(benchmarks.SPY)].sort((a, b) => a.date.localeCompare(b.date));
  const qqq = [...toValueSeries(benchmarks.QQQ)].sort((a, b) => a.date.localeCompare(b.date));

  const rows: ComparisonRow[] = [];
  for (const window of BENCHMARK_WINDOWS) {
    const startDate = windowStart(endDate, window);
    // Skip windows the portfolio can't cover — a forward-filled start point
    // from before the first snapshot would report a bogus return.
    if (firstDate > startDate) continue;

    const portfolioPct = returnBetween(pSorted, startDate, endDate);
    if (portfolioPct == null) continue;

    const spyPct = returnBetween(spy, startDate, endDate);
    const qqqPct = returnBetween(qqq, startDate, endDate);
    rows.push({
      window,
      portfolioPct,
      spyPct,
      qqqPct,
      deltaVsSpy: spyPct == null ? null : portfolioPct - spyPct,
      deltaVsQqq: qqqPct == null ? null : portfolioPct - qqqPct,
    });
  }
  return rows;
}
