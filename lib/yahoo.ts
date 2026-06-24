/**
 * Yahoo Finance daily historical close prices — free, no API key.
 *
 * Chart endpoint:
 *   https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1y&interval=1d
 *
 * Returns JSON with parallel `timestamp[]` and `indicators.quote[0].close[]`
 * arrays. Cached in Next's Data Cache for 6h (daily closes don't move intraday).
 *
 * (We originally targeted Stooq's CSV endpoint, but it now serves a JS anti-bot
 * challenge to server-side callers, so it can't be fetched headless.)
 */

export type PricePoint = { date: string; close: number };

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
  };
};

/** Map a lookback in months to Yahoo's `range` parameter. */
function rangeForMonths(months: number): string {
  if (months <= 1) return "1mo";
  if (months <= 3) return "3mo";
  if (months <= 6) return "6mo";
  if (months <= 12) return "1y";
  if (months <= 24) return "2y";
  return "5y";
}

/** Daily close history for a single ticker over the last `months`, oldest first. */
export async function getDailyCloses(ticker: string, months = 12): Promise<PricePoint[]> {
  const sym = ticker.trim().toUpperCase();
  const range = rangeForMonths(months);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    sym,
  )}?range=${range}&interval=1d`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 21600 }, // 6h
    });
    if (!res.ok) return [];

    const j = (await res.json()) as YahooChart;
    const result = j.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];

    const out: PricePoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = closes[i];
      if (typeof close === "number" && Number.isFinite(close)) {
        out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close });
      }
    }
    return out;
  } catch {
    return [];
  }
}
