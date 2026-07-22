/**
 * Analysis desk data layer — turns your equity holdings into a risk/technical/
 * fundamental read: per-holding momentum + valuation + IV rank + beta, plus
 * portfolio-level beta, concentration, sector exposure, and a correlation
 * matrix of the largest positions. Fans out cached Yahoo OHLCV + batched
 * Finnhub fundamentals; degrades gracefully (nulls) when a source is missing.
 */

import { getDailyOHLCV, getDailyCloses } from "@/lib/yahoo";
import { getCompanyProfiles, getBasicFinancials, getEarningsCalendar } from "@/lib/finnhub";
import { getHoldings } from "@/lib/queries";
import { parseOccSymbol } from "@/lib/options";
import { getIvRank } from "@/lib/iv-rank";
import { rsi, realizedVol, pctOf52wRange, momentum, maxDrawdown, sma } from "@/lib/technicals";
import { betaTo, correlationTo, portfolioBeta, type CloseSeries } from "@/lib/correlation";

export type HoldingAnalytics = {
  ticker: string;
  value: number;
  weightPct: number;
  sector: string | null;
  price: number | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  rsi: number | null;
  realizedVol: number | null; // annualized %
  pctRange: number | null; // 0–100 within 1y range
  mom1m: number | null;
  mom3m: number | null;
  maxDrawdown: number | null;
  beta: number | null;
  peTtm: number | null;
  netMargin: number | null;
  roe: number | null;
  marketCap: number | null;
  dividendYield: number | null;
  ivRank: number | null;
  nextEarnings: string | null;
  /** For the risk/return scatter: 1y total return %. */
  return1y: number | null;
};

export type SectorExposure = { sector: string; value: number; pct: number };

export type AnalysisData = {
  holdings: HoldingAnalytics[];
  portfolio: {
    totalValue: number;
    beta: number | null;
    /** Share of the book in the single largest position, percent. */
    topConcentrationPct: number | null;
    /** Share in the top 5 positions, percent. */
    top5ConcentrationPct: number | null;
    sectors: SectorExposure[];
  };
  correlation: { tickers: string[]; matrix: (number | null)[][] };
  fundamentalsAvailable: boolean;
  asOf: string;
};

/** Aggregate priced equity holdings (non-option) by ticker. */
function equityPositions(): Array<{ ticker: string; value: number }> {
  const byTicker = new Map<string, number>();
  for (const h of getHoldings()) {
    const t = h.ticker?.trim().toUpperCase();
    if (!t || parseOccSymbol(t)) continue; // skip options
    if (t.includes(":") || t.includes("/")) continue; // skip cash/currency pseudo-tickers (e.g. CUR:USD)
    const v = h.value ?? 0;
    if (!(v > 0)) continue;
    byTicker.set(t, (byTicker.get(t) ?? 0) + v);
  }
  return [...byTicker.entries()].map(([ticker, value]) => ({ ticker, value })).sort((a, b) => b.value - a.value);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function buildAnalysisData(): Promise<AnalysisData> {
  const candidates = equityPositions();

  // Fetch the benchmark + per-ticker OHLCV first (cached 6h). This lets us drop
  // anything without a real listed price history — money-market funds, cash
  // sweeps, opaque symbols — before spending Finnhub calls or diluting weights
  // with holdings that can't be analyzed.
  const [spyCloses, ohlcvAll] = await Promise.all([
    getDailyCloses("SPY", 12),
    mapLimit(candidates.map((c) => c.ticker), 8, (t) => getDailyOHLCV(t, 12)),
  ]);

  const kept = candidates
    .map((pos, i) => ({ pos, bars: ohlcvAll[i] ?? [] }))
    .filter((k) => k.bars.length > 20); // enough history to compute technicals

  const tickers = kept.map((k) => k.pos.ticker);
  const totalValue = kept.reduce((a, k) => a + k.pos.value, 0);

  const [profiles, financials, earnings] = await Promise.all([
    getCompanyProfiles(tickers),
    getBasicFinancials(tickers),
    getEarningsCalendar(),
  ]);

  const spySeries: CloseSeries = spyCloses.map((p) => ({ date: p.date, close: p.close }));
  const closesByTicker = new Map<string, CloseSeries>();

  const holdings: HoldingAnalytics[] = kept.map(({ pos, bars }) => {
    const closes = bars.map((b) => b.close);
    const series: CloseSeries = bars.map((b) => ({ date: b.date, close: b.close }));
    closesByTicker.set(pos.ticker, series);
    const price = closes.length ? closes[closes.length - 1] : null;
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const fin = financials[pos.ticker];
    const prof = profiles[pos.ticker];
    const iv = getIvRank(pos.ticker);
    const first = closes.length ? closes[0] : null;

    return {
      ticker: pos.ticker,
      value: pos.value,
      weightPct: totalValue > 0 ? (pos.value / totalValue) * 100 : 0,
      sector: prof?.sector ?? null,
      price,
      aboveSma50: price != null && s50 != null ? price > s50 : null,
      aboveSma200: price != null && s200 != null ? price > s200 : null,
      rsi: rsi(closes),
      realizedVol: realizedVol(closes),
      pctRange: pctOf52wRange(closes),
      mom1m: momentum(closes, 21),
      mom3m: momentum(closes, 63),
      maxDrawdown: maxDrawdown(closes),
      beta: betaTo(series, spySeries),
      peTtm: fin?.peTtm ?? null,
      netMargin: fin?.netMargin ?? null,
      roe: fin?.roe ?? null,
      marketCap: prof?.marketCap ?? null,
      dividendYield: fin?.dividendYield ?? null,
      ivRank: iv?.ivRank ?? null,
      nextEarnings: earnings[pos.ticker] ?? null,
      return1y: price != null && first != null && first > 0 ? ((price - first) / first) * 100 : null,
    };
  });

  // Sector exposure.
  const sectorMap = new Map<string, number>();
  for (const h of holdings) {
    const key = h.sector ?? "Unclassified";
    sectorMap.set(key, (sectorMap.get(key) ?? 0) + h.value);
  }
  const sectors: SectorExposure[] = [...sectorMap.entries()]
    .map(([sector, value]) => ({ sector, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  // Correlation matrix of the largest positions.
  const top = holdings.slice(0, 8).map((h) => h.ticker);
  const matrix: (number | null)[][] = top.map((a) =>
    top.map((b) => {
      if (a === b) return 1;
      const sa = closesByTicker.get(a);
      const sb = closesByTicker.get(b);
      return sa && sb ? correlationTo(sa, sb) : null;
    }),
  );

  const sorted = [...holdings].sort((a, b) => b.value - a.value);
  return {
    holdings,
    portfolio: {
      totalValue,
      beta: portfolioBeta(holdings),
      topConcentrationPct: sorted[0] && totalValue > 0 ? (sorted[0].value / totalValue) * 100 : null,
      top5ConcentrationPct:
        totalValue > 0 ? (sorted.slice(0, 5).reduce((a, h) => a + h.value, 0) / totalValue) * 100 : null,
      sectors,
    },
    correlation: { tickers: top, matrix },
    fundamentalsAvailable: Object.keys(profiles).length > 0 || Object.keys(financials).length > 0,
    asOf: new Date().toISOString(),
  };
}
