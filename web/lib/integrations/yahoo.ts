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

import { parseOccSymbol } from "@/lib/options";

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

export type OHLCVPoint = { date: string; open: number; high: number; low: number; close: number; volume: number | null };

/**
 * Daily OHLCV history for a ticker over the last `months`, oldest first. Same
 * chart endpoint as getDailyCloses but keeps open/high/low/volume (which the
 * closes-only path discards) — needed for ATR-based stops, RSI, and range.
 */
export async function getDailyOHLCV(ticker: string, months = 12): Promise<OHLCVPoint[]> {
  const sym = ticker.trim().toUpperCase();
  const range = rangeForMonths(months);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    sym,
  )}?range=${range}&interval=1d`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 21600 } });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }>;
          };
        }>;
      };
    };
    const r = j.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0];
    const out: OHLCVPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = q?.close?.[i];
      const open = q?.open?.[i];
      const high = q?.high?.[i];
      const low = q?.low?.[i];
      if ([open, high, low, close].every((v) => typeof v === "number" && Number.isFinite(v))) {
        out.push({
          date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          open: open as number,
          high: high as number,
          low: low as number,
          close: close as number,
          volume: typeof q?.volume?.[i] === "number" ? (q!.volume![i] as number) : null,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ── Charting bars (arbitrary range × interval) ───────────────────────────────

/**
 * The timeframes the markets desk offers. `1h` is Yahoo's `60m` under a name
 * that reads like a chart button; everything else is passed through verbatim.
 */
export type BarInterval = "5m" | "15m" | "30m" | "1h" | "1d" | "1wk" | "1mo";

/** Lookback windows Yahoo's chart endpoint accepts. */
export type BarRange = "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "10y" | "max";

/** One chart bar. `t` is epoch **milliseconds** at the bar's open. */
export type ChartBar = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

/** What Yahoo knows about the symbol itself, for the chart header. */
export type BarMeta = {
  symbol: string;
  currency: string | null;
  exchangeName: string | null;
  instrumentType: string | null;
  /** Latest traded price Yahoo reports (may be more recent than the last bar). */
  regularMarketPrice: number | null;
  /** Previous session's close, for the day-change readout. */
  previousClose: number | null;
};

export type BarSeries = { bars: ChartBar[]; meta: BarMeta | null };

const YAHOO_INTERVAL: Record<BarInterval, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "1d": "1d",
  "1wk": "1wk",
  "1mo": "1mo",
};

/**
 * Yahoo caps how far back intraday data goes: ~60 days for sub-hourly bars,
 * ~730 days for hourly. Asking for more returns an error rather than a clamped
 * window, so we clamp before asking.
 */
const MAX_RANGE: Partial<Record<BarInterval, BarRange>> = {
  "5m": "1mo",
  "15m": "1mo",
  "30m": "1mo",
  "1h": "2y",
};

const RANGE_ORDER: BarRange[] = ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"];

/** The requested range, or the widest one this interval actually supports. */
export function clampRange(range: BarRange, interval: BarInterval): BarRange {
  const cap = MAX_RANGE[interval];
  if (!cap) return range;
  return RANGE_ORDER.indexOf(range) > RANGE_ORDER.indexOf(cap) ? cap : range;
}

/**
 * OHLCV bars for one symbol at an arbitrary range × interval, oldest-first.
 *
 * Separate from `getDailyOHLCV` because a chart needs three things that
 * function deliberately drops: intraday intervals, epoch timestamps (a
 * date-only string can't label a 15-minute bar), and the `meta` block that
 * carries the live price and previous close. Returns empty rather than throwing
 * so one bad symbol in a watchlist can't take the whole desk down.
 *
 * Cache: intraday bars revalidate every minute, daily-and-slower every 10, which
 * is as live as a delayed free feed is worth polling.
 */
export async function getBars(
  ticker: string,
  range: BarRange = "6mo",
  interval: BarInterval = "1d",
): Promise<BarSeries> {
  const sym = ticker.trim().toUpperCase();
  if (!sym) return { bars: [], meta: null };

  const iv = YAHOO_INTERVAL[interval] ?? "1d";
  const r = clampRange(range, interval);
  const intraday = interval.endsWith("m") || interval === "1h";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    sym,
  )}?range=${r}&interval=${iv}&includePrePost=false`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: intraday ? 60 : 600 },
    });
    if (!res.ok) return { bars: [], meta: null };

    const j = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            symbol?: string;
            currency?: string;
            fullExchangeName?: string;
            exchangeName?: string;
            instrumentType?: string;
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
          };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
              volume?: (number | null)[];
            }>;
          };
        }>;
      };
    };

    const result = j.chart?.result?.[0];
    if (!result) return { bars: [], meta: null };

    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0];
    const bars: ChartBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const open = q?.open?.[i];
      const high = q?.high?.[i];
      const low = q?.low?.[i];
      const close = q?.close?.[i];
      // Yahoo pads holidays and halted sessions with nulls; a candle needs all
      // four legs, so an incomplete bar is dropped rather than interpolated.
      if (![open, high, low, close].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
      bars.push({
        t: ts[i] * 1000,
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: typeof q?.volume?.[i] === "number" ? (q!.volume![i] as number) : null,
      });
    }

    const m = result.meta;
    const meta: BarMeta = {
      symbol: m?.symbol ?? sym,
      currency: m?.currency ?? null,
      exchangeName: m?.fullExchangeName ?? m?.exchangeName ?? null,
      instrumentType: m?.instrumentType ?? null,
      regularMarketPrice: typeof m?.regularMarketPrice === "number" ? m.regularMarketPrice : null,
      previousClose:
        typeof m?.previousClose === "number"
          ? m.previousClose
          : typeof m?.chartPreviousClose === "number"
            ? m.chartPreviousClose
            : null,
    };

    return { bars, meta };
  } catch {
    return { bars: [], meta: null };
  }
}

/**
 * `getBars` for a whole watchlist, capped at 6 in flight so a 20-symbol list
 * doesn't open 20 sockets to Yahoo at once. Symbols that fail come back with an
 * empty series rather than rejecting the batch.
 */
export async function getBarsFor(
  tickers: string[],
  range: BarRange = "6mo",
  interval: BarInterval = "1d",
): Promise<Record<string, BarSeries>> {
  const syms = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const out: Record<string, BarSeries> = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, syms.length) }, async () => {
      for (let i = next++; i < syms.length; i = next++) {
        out[syms[i]] = await getBars(syms[i], range, interval);
      }
    }),
  );
  return out;
}

/** One candidate from Yahoo's symbol search. */
export type SymbolMatch = {
  symbol: string;
  name: string | null;
  /** Display exchange, e.g. "NasdaqGS" or "CCC" for crypto. */
  exchange: string | null;
  /** Display instrument type, e.g. "Equity", "ETF", "Cryptocurrency". */
  type: string | null;
};

/**
 * Search Yahoo for symbols matching a name or partial ticker.
 *
 * This is what the markets desk offers when a held position's ticker doesn't
 * resolve to a chart — a broker's `BRKB`, a foreign listing missing its `.DE`
 * suffix, a wallet token Yahoo lists under a different pair. The answer is
 * stored as a source redirect (see lib/watchlist.ts), not as a rename.
 *
 * Cached for an hour: the universe of listed symbols does not move minute to
 * minute, and the same failing symbol is searched on every visit to the desk.
 */
export async function searchSymbols(query: string, limit = 8): Promise<SymbolMatch[]> {
  const q = query.trim();
  if (!q) return [];

  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}` +
    `&quotesCount=${Math.min(20, Math.max(1, limit))}&newsCount=0&enableFuzzyQuery=true` +
    `&quotesQueryId=tss_match_phrase_query`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];

    const j = (await res.json()) as {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        exchDisp?: string;
        exchange?: string;
        typeDisp?: string;
        quoteType?: string;
        isYahooFinance?: boolean;
      }>;
    };

    const out: SymbolMatch[] = [];
    for (const q of j.quotes ?? []) {
      // The search also returns industries and private companies, which have no
      // symbol and no chart behind them.
      if (!q.symbol || q.isYahooFinance === false) continue;
      out.push({
        symbol: q.symbol.toUpperCase(),
        name: q.longname ?? q.shortname ?? null,
        exchange: q.exchDisp ?? q.exchange ?? null,
        type: q.typeDisp ?? q.quoteType ?? null,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** A corporate split event fetched from Yahoo. Ratio is shares-after : before. */
export type SplitEvent = { date: string; numerator: number; denominator: number };

/**
 * Fetch a ticker's split history from Yahoo's chart API (`events=split`). Returns
 * [] on any failure so callers degrade gracefully. Used to auto-suggest the
 * corporate actions an imported trade history needs to reconcile correctly.
 */
export async function getSplitEvents(ticker: string, years = 20): Promise<SplitEvent[]> {
  const sym = ticker.trim().toUpperCase();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    sym,
  )}?range=${years}y&interval=1mo&events=split`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 86400 }, // 1d — split history rarely changes
    });
    if (!res.ok) return [];

    const j = (await res.json()) as {
      chart?: { result?: { events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> } }[] };
    };
    const splits = j.chart?.result?.[0]?.events?.splits ?? {};
    return Object.values(splits)
      .map((s) => ({
        date: new Date(s.date * 1000).toISOString().slice(0, 10),
        numerator: s.numerator,
        denominator: s.denominator,
      }))
      .filter((s) => s.numerator > 0 && s.denominator > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

/**
 * Yahoo Finance option chain — free, no API key.
 *
 *   https://query1.finance.yahoo.com/v7/finance/options/AAPL
 *   https://query1.finance.yahoo.com/v7/finance/options/AAPL?date=<epoch>
 *
 * The base call returns the underlying quote, the full list of `expirationDates`,
 * and the contracts for the *nearest* expiry only. To cover contracts we actually
 * hold on later expiries, we additionally fetch each requested expiry by its
 * epoch. Implied volatilities feed the Black-Scholes Greeks; nothing is persisted.
 *
 * Cached in Next's Data Cache for 30m — IV drifts intraday but not by the second.
 */

/** Live per-share option Greeks carried on a chain quote (source-provided). */
export type QuoteGreeks = {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
};

/** One live option contract quote from the chain, greeks-ready. */
export type OptionQuote = {
  /** OCC/contract symbol, uppercased. */
  occ: string;
  /** Expiry as YYYY-MM-DD. */
  expiry: string;
  strike: number;
  right: "call" | "put";
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** Implied volatility as a decimal (0.42), or null. */
  iv: number | null;
  openInterest: number | null;
  volume: number | null;
  /** In-the-money flag, or null when absent. */
  inTheMoney: boolean | null;
  /** Source-provided Greeks (CBOE), or null fields when unavailable. */
  greeks?: QuoteGreeks | null;
};

export type OptionChain = {
  /** Live underlying price Yahoo quotes alongside the chain, or null. */
  underlyingPrice: number | null;
  /** Every listed expiry as a UTC epoch (seconds). */
  expirations: number[];
  /** Implied volatility keyed by OCC/contract symbol (decimal, e.g. 0.42). */
  ivByOcc: Record<string, number>;
  /** Full contract quotes we pulled (nearest expiry + any requested ones). */
  contracts: OptionQuote[];
};

type YahooOptionContract = {
  contractSymbol?: string;
  strike?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
  inTheMoney?: boolean;
  expiration?: number;
};

type YahooOptionChain = {
  optionChain?: {
    result?: Array<{
      quote?: { regularMarketPrice?: number };
      expirationDates?: number[];
      options?: Array<{ calls?: YahooOptionContract[]; puts?: YahooOptionContract[] }>;
    }>;
  };
};

/** Finite number, else null. */
function numOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Fetch the option chain for `underlying`. When `expiries` (YYYY-MM-DD) are
 * given, also pull those specific expirations so their contracts' IV is present.
 * Returns null only on a hard failure; a partial chain still resolves.
 */
export async function getOptionChain(
  underlying: string,
  expiries: string[] = [],
): Promise<OptionChain | null> {
  const sym = underlying.trim().toUpperCase();
  const base = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(sym)}`;

  const ivByOcc: Record<string, number> = {};
  const byOcc = new Map<string, OptionQuote>();
  let underlyingPrice: number | null = null;
  let expirations: number[] = [];

  function ingest(c: YahooOptionContract, right: "call" | "put"): void {
    const occ = c.contractSymbol?.toUpperCase();
    if (!occ) return;
    const iv = typeof c.impliedVolatility === "number" && c.impliedVolatility > 0 ? c.impliedVolatility : null;
    if (iv != null) ivByOcc[occ] = iv;
    // OCC symbol carries a reliable expiry + strike; fall back to Yahoo's fields.
    const parsed = parseOccSymbol(occ);
    const expiry =
      parsed?.expiry ??
      (c.expiration != null ? new Date(c.expiration * 1000).toISOString().slice(0, 10) : "");
    byOcc.set(occ, {
      occ,
      expiry,
      strike: parsed?.strike ?? numOrNull(c.strike) ?? 0,
      right,
      bid: numOrNull(c.bid),
      ask: numOrNull(c.ask),
      last: numOrNull(c.lastPrice),
      iv,
      openInterest: numOrNull(c.openInterest),
      volume: numOrNull(c.volume),
      inTheMoney: typeof c.inTheMoney === "boolean" ? c.inTheMoney : null,
    });
  }

  async function pull(url: string): Promise<void> {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 1800 }, // 30m
    });
    if (!res.ok) return;
    const j = (await res.json()) as YahooOptionChain;
    const r = j.optionChain?.result?.[0];
    if (!r) return;
    if (typeof r.quote?.regularMarketPrice === "number") {
      underlyingPrice = r.quote.regularMarketPrice;
    }
    if (r.expirationDates?.length) expirations = r.expirationDates;
    for (const bundle of r.options ?? []) {
      for (const c of bundle.calls ?? []) ingest(c, "call");
      for (const c of bundle.puts ?? []) ingest(c, "put");
    }
  }

  try {
    await pull(base);

    // Pull each requested expiry we haven't already covered (skip the nearest,
    // which the base call returned).
    if (expiries.length && expirations.length) {
      const wanted = new Set(expiries);
      const nearest = expirations[0];
      const epochs = expirations.filter(
        (ep) => ep !== nearest && wanted.has(new Date(ep * 1000).toISOString().slice(0, 10)),
      );
      await Promise.all(epochs.map((ep) => pull(`${base}?date=${ep}`)));
    }

    return { underlyingPrice, expirations, ivByOcc, contracts: [...byOcc.values()] };
  } catch {
    return null;
  }
}

/**
 * Yahoo Finance dividend calendar — free, no API key.
 *
 *   https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,MSFT
 *
 * The batch quote endpoint carries each symbol's `exDividendDate` and
 * `dividendDate` (pay date) as UTC epochs, plus the trailing annual dividend
 * rate/yield. We only surface symbols that actually pay (have an ex-div date),
 * so non-payers drop out. Cached in Next's Data Cache for 6h like the closes —
 * ex-div dates don't move intraday. A hard failure resolves to `[]` so the
 * calendar just renders empty rather than breaking the page.
 */

export type DividendCalendarEntry = {
  symbol: string;
  /** Upcoming (or most recent) ex-dividend date, YYYY-MM-DD, or null. */
  exDividendDate: string | null;
  /** Dividend pay date, YYYY-MM-DD, or null. */
  payDate: string | null;
  /** Trailing annual dividend per share, or null. */
  rate: number | null;
  /** Trailing annual dividend yield, percent, or null. */
  yield: number | null;
};

type YahooQuoteResult = {
  symbol?: string;
  exDividendDate?: number;
  dividendDate?: number;
  dividendRate?: number;
  trailingAnnualDividendRate?: number;
  dividendYield?: number;
  trailingAnnualDividendYield?: number;
};

type YahooQuote = {
  quoteResponse?: { result?: YahooQuoteResult[] };
};

/** Epoch (seconds) → YYYY-MM-DD, or null when missing/non-finite. */
function epochToDate(sec: number | undefined): string | null {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

/** Ex-dividend + pay dates for the given symbols. Only dividend payers returned. */
export async function getDividendCalendar(symbols: string[]): Promise<DividendCalendarEntry[]> {
  const unique = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  );
  if (unique.length === 0) return [];

  const out: DividendCalendarEntry[] = [];

  // Batch into chunks — the quote endpoint accepts many symbols per call.
  const CHUNK = 50;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      batch.join(","),
    )}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 21600 }, // 6h
      });
      if (!res.ok) continue;
      const j = (await res.json()) as YahooQuote;
      for (const r of j.quoteResponse?.result ?? []) {
        if (!r.symbol) continue;
        const exDividendDate = epochToDate(r.exDividendDate);
        const payDate = epochToDate(r.dividendDate);
        // Skip non-payers — no ex-div and no pay date means no dividend.
        if (!exDividendDate && !payDate) continue;
        const rate = r.trailingAnnualDividendRate ?? r.dividendRate ?? null;
        const rawYield = r.trailingAnnualDividendYield ?? r.dividendYield ?? null;
        out.push({
          symbol: r.symbol.toUpperCase(),
          exDividendDate,
          payDate,
          rate: typeof rate === "number" && Number.isFinite(rate) ? rate : null,
          // Yahoo reports trailing yield as a fraction (0.0056 → 0.56%).
          yield:
            typeof rawYield === "number" && Number.isFinite(rawYield) ? rawYield * 100 : null,
        });
      }
    } catch {
      /* best-effort — skip this batch */
    }
  }

  return out;
}
