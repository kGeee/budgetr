import { getDailyCloses, type PricePoint } from "@/lib/yahoo";

export type { PricePoint };

export type Position = { ticker: string; quantity: number };
export type HoldingQty = { ticker: string | null; quantity: number | null };
export type Trade = { ticker: string | null; date: string; quantity: number | null };

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

/**
 * Fold off-Plaid holdings into the daily net-worth series so the dashboard
 * reflects everything you own, not just linked accounts.
 *
 * - `manualSeries` is the tickered manual holdings' value over time (from
 *   buildReconstructedSeries), forward-filled onto each snapshot date.
 * - `fixedValueTotal` is the (constant) sum of fixed-value assets.
 * - `today` appends/overwrites a current point so the line ends live, including
 *   manual holdings and the latest account balances.
 */
export function overlayNetWorth(
  base: { date: string; netWorth: number }[],
  manualSeries: { date: string; value: number }[],
  fixedValueTotal: number,
  today: { date: string; net: number } | null,
): { date: string; netWorth: number }[] {
  const sorted = [...manualSeries].sort((a, b) => a.date.localeCompare(b.date));
  const valAt = (date: string): number => {
    let v = 0;
    for (const p of sorted) {
      if (p.date <= date) v = p.value;
      else break;
    }
    return v;
  };

  const out = base.map((b) => ({
    date: b.date,
    netWorth: b.netWorth + valAt(b.date) + fixedValueTotal,
  }));

  if (today) {
    if (out.length > 0 && out[out.length - 1].date >= today.date) {
      out[out.length - 1] = { date: out[out.length - 1].date, netWorth: today.net };
    } else {
      out.push({ date: today.date, netWorth: today.net });
    }
  }
  return out;
}

/**
 * Portfolio market value over time, reconstructed from trade history.
 *
 * Anchors to the *current* holding quantity and walks the buy/sell ledger to
 * recover how many shares were held on each past day:
 *
 *   sharesHeld(date) = baseline + Σ trade.quantity for trades on or before date
 *   baseline         = currentQuantity − Σ all trades in the window
 *
 * The baseline captures shares acquired before our (2-year) trade window, held
 * as a constant before the first trade. So today's reconstructed count always
 * equals the real current holding, while earlier days reflect what was actually
 * owned then — fixing the survivorship bias of charting today's shares at old
 * prices. Each day's value forward-fills the last known close per ticker.
 */
export function buildReconstructedSeries(
  holdings: HoldingQty[],
  trades: Trade[],
  histories: Record<string, PricePoint[]>,
): { date: string; value: number }[] {
  const currentQty = new Map<string, number>();
  for (const h of holdings) {
    if (!h.ticker) continue;
    const sym = h.ticker.toUpperCase();
    currentQty.set(sym, (currentQty.get(sym) ?? 0) + (h.quantity ?? 0));
  }

  const tradesByTicker = new Map<string, { date: string; quantity: number }[]>();
  for (const t of trades) {
    if (!t.ticker || !t.quantity) continue;
    const sym = t.ticker.toUpperCase();
    if (!tradesByTicker.has(sym)) tradesByTicker.set(sym, []);
    tradesByTicker.get(sym)!.push({ date: t.date, quantity: t.quantity });
  }
  for (const arr of tradesByTicker.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  const tickers = [...new Set([...currentQty.keys(), ...tradesByTicker.keys()])].filter(
    (sym) => histories[sym]?.length,
  );
  if (tickers.length === 0) return [];

  // Shares held before the trade window opened (constant until the first trade).
  const baseline = new Map<string, number>();
  for (const sym of tickers) {
    const sumTrades = (tradesByTicker.get(sym) ?? []).reduce((s, t) => s + t.quantity, 0);
    baseline.set(sym, (currentQty.get(sym) ?? 0) - sumTrades);
  }

  const dateSet = new Set<string>();
  const priceMaps: Record<string, Map<string, number>> = {};
  for (const sym of tickers) {
    const map = new Map<string, number>();
    for (const pt of histories[sym]) {
      map.set(pt.date, pt.close);
      dateSet.add(pt.date);
    }
    priceMaps[sym] = map;
  }
  const dates = [...dateSet].sort();

  // Sweep dates ascending, advancing each ticker's trade pointer + share count.
  const ptr = new Map<string, number>();
  const shares = new Map<string, number>();
  const lastClose: Record<string, number | null> = {};
  for (const sym of tickers) {
    ptr.set(sym, 0);
    shares.set(sym, baseline.get(sym) ?? 0);
    lastClose[sym] = null;
  }

  const series: { date: string; value: number }[] = [];
  for (const date of dates) {
    let value = 0;
    let any = false;
    for (const sym of tickers) {
      const arr = tradesByTicker.get(sym) ?? [];
      let p = ptr.get(sym)!;
      let held = shares.get(sym)!;
      while (p < arr.length && arr[p].date <= date) {
        held += arr[p].quantity;
        p++;
      }
      ptr.set(sym, p);
      shares.set(sym, held);

      const close = priceMaps[sym].get(date);
      if (close != null) lastClose[sym] = close;
      const px = lastClose[sym];
      const sh = Math.max(held, 0);
      if (px != null && sh > 0) {
        value += px * sh;
        any = true;
      }
    }
    if (any) series.push({ date, value });
  }
  return series;
}
