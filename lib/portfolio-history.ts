import { getDailyCloses, type PricePoint } from "@/lib/yahoo";

export type { PricePoint };

export type Position = { ticker: string; quantity: number };

/** Per-ticker daily close history, keyed by UPPER-cased ticker. */
export async function getTickerHistories(
  symbols: string[],
  months = 12,
): Promise<Record<string, PricePoint[]>> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (sym) => [sym, await getDailyCloses(sym, months)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Portfolio market value over time.
 *
 * Plaid only gives us *current* quantities, not historical lots, so this charts
 * "what today's holdings would have been worth" — current quantity × each day's
 * historical close. For every trading day in the union across tickers we
 * forward-fill each ticker's last known close, so a missing day for one symbol
 * doesn't drop it out of the total.
 */
export function buildPortfolioSeries(
  positions: Position[],
  histories: Record<string, PricePoint[]>,
): { date: string; value: number }[] {
  const used = positions.filter(
    (p) => p.quantity && histories[p.ticker.toUpperCase()]?.length,
  );
  if (used.length === 0) return [];

  const dateSet = new Set<string>();
  const priceMaps: Record<string, Map<string, number>> = {};
  for (const p of used) {
    const sym = p.ticker.toUpperCase();
    const map = new Map<string, number>();
    for (const pt of histories[sym]) {
      map.set(pt.date, pt.close);
      dateSet.add(pt.date);
    }
    priceMaps[sym] = map;
  }

  const dates = [...dateSet].sort();
  const lastClose: Record<string, number | null> = {};
  for (const p of used) lastClose[p.ticker.toUpperCase()] = null;

  const series: { date: string; value: number }[] = [];
  for (const date of dates) {
    let value = 0;
    let any = false;
    for (const p of used) {
      const sym = p.ticker.toUpperCase();
      const close = priceMaps[sym].get(date);
      if (close != null) lastClose[sym] = close;
      const px = lastClose[sym];
      if (px != null) {
        value += px * p.quantity;
        any = true;
      }
    }
    if (any) series.push({ date, value });
  }
  return series;
}
