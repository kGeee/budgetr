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

const BASE = "https://finnhub.io/api/v1";

/** The Finnhub API key, or undefined when not configured. */
export function finnhubToken(): string | undefined {
  return process.env.FINNHUB_API_KEY?.trim() || undefined;
}

/** True when a Finnhub API key is present in the environment. */
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
