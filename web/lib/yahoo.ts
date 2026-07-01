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

export type OptionChain = {
  /** Live underlying price Yahoo quotes alongside the chain, or null. */
  underlyingPrice: number | null;
  /** Every listed expiry as a UTC epoch (seconds). */
  expirations: number[];
  /** Implied volatility keyed by OCC/contract symbol (decimal, e.g. 0.42). */
  ivByOcc: Record<string, number>;
};

type YahooOptionContract = {
  contractSymbol?: string;
  impliedVolatility?: number;
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
  let underlyingPrice: number | null = null;
  let expirations: number[] = [];

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
      for (const c of [...(bundle.calls ?? []), ...(bundle.puts ?? [])]) {
        if (c.contractSymbol && typeof c.impliedVolatility === "number" && c.impliedVolatility > 0) {
          ivByOcc[c.contractSymbol.toUpperCase()] = c.impliedVolatility;
        }
      }
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

    return { underlyingPrice, expirations, ivByOcc };
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
