/**
 * Finnhub market-data helpers (server-side only).
 *
 * We use Finnhub for live ticker prices layered on top of the holdings that
 * Plaid gives us: Plaid supplies quantities/cost basis (and an end-of-day
 * institutional price), while Finnhub supplies the current/last trade price.
 *
 * - REST `/quote` is used for the initial snapshot when the page loads (works
 *   even when the market is closed — it returns the last close).
 * - The WebSocket trade stream (see components/live-prices.tsx) provides the
 *   real-time ticking updates while the market is open.
 */

import { getFinnhubKey } from "@/lib/app-config";

const BASE = "https://finnhub.io/api/v1";

/** The Finnhub API key (DB-backed config → env fallback), or undefined. */
export function finnhubToken(): string | undefined {
  return getFinnhubKey() ?? undefined;
}

/** True when a Finnhub API key is configured (DB or env). */
export function hasFinnhubKey(): boolean {
  return Boolean(finnhubToken());
}

export type Quote = {
  symbol: string;
  /** Current / last trade price, or null when unavailable. */
  price: number | null;
  /** Previous close, used to compute day change. */
  prevClose: number | null;
};

/** Normalize, de-dupe, and upper-case a list of ticker symbols. */
function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

// Finnhub's free tier allows 60 REST calls/minute. A brokerage user can easily
// hold 20-50 positions, so we fetch in capped batches with a short pause
// between them rather than firing every symbol at once and tripping the limit.
const QUOTE_BATCH_SIZE = 15;
const QUOTE_BATCH_PAUSE_MS = 1_100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch current quotes for the given symbols from Finnhub's REST API.
 * Returns a map keyed by upper-cased symbol. Symbols that fail to resolve are
 * simply omitted (we fall back to the Plaid price for those).
 */
export async function getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const token = finnhubToken();
  if (!token) return {};

  const unique = normalizeSymbols(symbols);
  const out: Record<string, Quote> = {};

  const fetchOne = async (sym: string) => {
    try {
      const url = `${BASE}/quote?symbol=${encodeURIComponent(sym)}&token=${token}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      // Finnhub /quote shape: { c: current, d, dp, h, l, o, pc: prevClose, t }
      const d = (await res.json()) as { c?: number; pc?: number };
      out[sym] = {
        symbol: sym,
        price: typeof d.c === "number" && d.c > 0 ? d.c : null,
        prevClose: typeof d.pc === "number" && d.pc > 0 ? d.pc : null,
      };
    } catch {
      // Network/parse error for a single symbol — skip it.
    }
  };

  for (let i = 0; i < unique.length; i += QUOTE_BATCH_SIZE) {
    const batch = unique.slice(i, i + QUOTE_BATCH_SIZE);
    await Promise.all(batch.map(fetchOne));
    if (i + QUOTE_BATCH_SIZE < unique.length) await sleep(QUOTE_BATCH_PAUSE_MS);
  }

  return out;
}

// ── Company profile & fundamentals ───────────────────────────────────
//
// Finnhub's /quote is all this app used before; profile2 + metric are the same
// keyed provider and give the fundamental context an analysis desk needs
// (sector, market cap, valuation, margins, beta, 52-week range). Both change
// slowly, so they cache for a day. Batched to respect the 60/min free tier.

export type CompanyProfile = {
  name: string | null;
  sector: string | null;
  exchange: string | null;
  /** Market cap in dollars (Finnhub reports millions). */
  marketCap: number | null;
};

export type BasicFinancials = {
  peTtm: number | null;
  pbAnnual: number | null;
  beta: number | null;
  /** Net profit margin, percent. */
  netMargin: number | null;
  /** Return on equity TTM, percent. */
  roe: number | null;
  high52: number | null;
  low52: number | null;
  /** Dividend yield, percent. */
  dividendYield: number | null;
};

async function batched<T>(symbols: string[], fetchOne: (sym: string) => Promise<T | null>): Promise<Record<string, T>> {
  const unique = normalizeSymbols(symbols);
  const out: Record<string, T> = {};
  for (let i = 0; i < unique.length; i += QUOTE_BATCH_SIZE) {
    const batch = unique.slice(i, i + QUOTE_BATCH_SIZE);
    await Promise.all(
      batch.map(async (sym) => {
        const v = await fetchOne(sym);
        if (v != null) out[sym] = v;
      }),
    );
    if (i + QUOTE_BATCH_SIZE < unique.length) await sleep(QUOTE_BATCH_PAUSE_MS);
  }
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Company profiles (sector / market cap / exchange) keyed by symbol. */
export async function getCompanyProfiles(symbols: string[]): Promise<Record<string, CompanyProfile>> {
  const token = finnhubToken();
  if (!token) return {};
  return batched(symbols, async (sym) => {
    try {
      const url = `${BASE}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`;
      const res = await fetch(url, { next: { revalidate: 86_400 } });
      if (!res.ok) return null;
      const d = (await res.json()) as { name?: string; finnhubIndustry?: string; marketCapitalization?: number; exchange?: string };
      const mcapM = num(d.marketCapitalization);
      return {
        name: d.name ?? null,
        sector: d.finnhubIndustry ?? null,
        exchange: d.exchange ?? null,
        marketCap: mcapM != null ? mcapM * 1_000_000 : null, // Finnhub reports millions
      };
    } catch {
      return null;
    }
  });
}

/** Valuation / quality / range metrics keyed by symbol. */
export async function getBasicFinancials(symbols: string[]): Promise<Record<string, BasicFinancials>> {
  const token = finnhubToken();
  if (!token) return {};
  return batched(symbols, async (sym) => {
    try {
      const url = `${BASE}/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${token}`;
      const res = await fetch(url, { next: { revalidate: 86_400 } });
      if (!res.ok) return null;
      const j = (await res.json()) as { metric?: Record<string, number | null> };
      const m = j.metric ?? {};
      return {
        peTtm: num(m.peTTM),
        pbAnnual: num(m.pbAnnual),
        beta: num(m.beta),
        netMargin: num(m.netProfitMarginTTM),
        roe: num(m.roeTTM),
        high52: num(m["52WeekHigh"]),
        low52: num(m["52WeekLow"]),
        dividendYield: num(m.currentDividendYieldTTM),
      };
    } catch {
      return null;
    }
  });
}

// ── Earnings calendar ────────────────────────────────────────────────
//
// A single unfiltered /calendar/earnings call returns every US company
// reporting in the window, so we fetch the whole window once and index it by
// symbol rather than making one rate-limited call per ticker. This is exactly
// what an options scanner needs: "does this underlying report before my expiry?"
// is the single most important risk flag for selling premium.

const YMD = (d: Date) => d.toISOString().slice(0, 10);

type FinnhubEarningsRow = { symbol?: string; date?: string };

/**
 * Map of upper-cased symbol → next earnings date (YYYY-MM-DD) within the given
 * window (default: today through +90d). Only the earliest upcoming date per
 * symbol is kept. Empty object when no key is configured or the call fails, so
 * callers degrade to "no known earnings" rather than breaking.
 */
export async function getEarningsCalendar(
  from: string = YMD(new Date()),
  to: string = YMD(new Date(Date.now() + 90 * 86_400_000)),
): Promise<Record<string, string>> {
  const token = finnhubToken();
  if (!token) return {};

  try {
    const url = `${BASE}/calendar/earnings?from=${from}&to=${to}&token=${token}`;
    const res = await fetch(url, { next: { revalidate: 43_200 } }); // 12h
    if (!res.ok) return {};
    const j = (await res.json()) as { earningsCalendar?: FinnhubEarningsRow[] };
    const out: Record<string, string> = {};
    for (const row of j.earningsCalendar ?? []) {
      const sym = row.symbol?.trim().toUpperCase();
      if (!sym || !row.date) continue;
      // Keep the earliest date per symbol within the window.
      if (!out[sym] || row.date < out[sym]) out[sym] = row.date;
    }
    return out;
  } catch {
    return {};
  }
}
