/**
 * CoinGecko crypto price helpers (server-side only).
 *
 * Finnhub (our equity/ETF feed) can't price plain `BTC-USD`-style crypto
 * symbols — its crypto quotes require exchange-prefixed tickers like
 * `COINBASE:BTC-USD`, and there's no free WebSocket for them. CoinGecko fills
 * that gap: a single REST call returns the current USD price plus the 24h
 * change, from which we derive a "previous close" so crypto holdings can count
 * toward the day-change / "priced today" coverage the same way equities do.
 *
 * There is no live tick stream for crypto — the REST snapshot is the live
 * price. That's enough for the portfolio view, which only needs a price and a
 * prior close to show a day change.
 *
 * The free/public API works with no key; a Demo or Pro key (env
 * COINGECKO_API_KEY) raises the rate limit and is sent as a header when set.
 */

import type { Quote } from "@/lib/finnhub";

const BASE = "https://api.coingecko.com/api/v3";

function coingeckoKey(): string | undefined {
  return process.env.COINGECKO_API_KEY || undefined;
}

/**
 * A holding symbol is crypto if it uses the Yahoo-style fiat-pair suffix
 * (`BTC-USD`, `ETH-USD`, …). US equity/ETF tickers never carry a `-USD`
 * suffix, so this cleanly separates the two feeds.
 */
export function isCryptoSymbol(symbol: string): boolean {
  return /-USD$/i.test(symbol.trim());
}

/**
 * Map of well-known crypto tickers → CoinGecko coin ids. CoinGecko's
 * `/coins/list` shares symbols across dozens of junk tokens, so for pricing we
 * rely on a curated map of majors rather than a symbol lookup. Unknown symbols
 * simply don't resolve here and fall back to the stored Yahoo close (same
 * behaviour as before this provider existed).
 */
const SYMBOL_TO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  HYPE: "hyperliquid",
  USDC: "usd-coin",
  USDT: "tether",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOT: "polkadot",
  MATIC: "matic-network",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  UNI: "uniswap",
  ATOM: "cosmos",
  XLM: "stellar",
  AAVE: "aave",
  ARB: "arbitrum",
  OP: "optimism",
  JUP: "jupiter-exchange-solana",
  BONK: "bonk",
  WIF: "dogwifcoin",
  PEPE: "pepe",
  SHIB: "shiba-inu",
  TON: "the-open-network",
  NEAR: "near",
  RNDR: "render-token",
  INJ: "injective-protocol",
};

/**
 * Resolve a holding symbol (`BTC-USD`, `HYPE32196-USD`) to a CoinGecko coin id.
 * Strips the `-USD` suffix and any trailing disambiguation digits Yahoo appends
 * on symbol collisions (`HYPE32196` → `HYPE`).
 */
function symbolToId(symbol: string): string | undefined {
  const base = symbol
    .trim()
    .toUpperCase()
    .replace(/-USD$/i, "")
    .replace(/\d+$/, "");
  return SYMBOL_TO_ID[base];
}

/**
 * Fetch current quotes for crypto symbols from CoinGecko. Returns a map keyed
 * by upper-cased symbol (matching the shape of `getQuotes` from finnhub.ts), so
 * callers can merge the two provider results directly. Symbols we can't resolve
 * are omitted (they fall back to the stored close).
 */
export async function getCryptoQuotes(
  symbols: string[],
): Promise<Record<string, Quote>> {
  // symbol (upper, full e.g. "BTC-USD") -> coingecko id
  const symToId = new Map<string, string>();
  for (const s of symbols) {
    const id = symbolToId(s);
    if (id) symToId.set(s.trim().toUpperCase(), id);
  }
  if (symToId.size === 0) return {};

  const ids = [...new Set(symToId.values())];
  const key = coingeckoKey();
  const url =
    `${BASE}/simple/price?ids=${encodeURIComponent(ids.join(","))}` +
    `&vs_currencies=usd&include_24hr_change=true`;

  let data: Record<string, { usd?: number; usd_24h_change?: number }>;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: key ? { "x-cg-demo-api-key": key } : {},
    });
    if (!res.ok) return {};
    data = await res.json();
  } catch {
    return {};
  }

  const out: Record<string, Quote> = {};
  for (const [sym, id] of symToId) {
    const row = data[id];
    if (!row || typeof row.usd !== "number" || row.usd <= 0) continue;
    const price = row.usd;
    // Derive prior close from the 24h % change: price = prevClose * (1 + chg/100).
    const chg = row.usd_24h_change;
    const prevClose =
      typeof chg === "number" && Number.isFinite(chg) && 1 + chg / 100 !== 0
        ? price / (1 + chg / 100)
        : null;
    out[sym] = { symbol: sym, price, prevClose };
  }
  return out;
}

// ── Wallet import helpers (on-chain token pricing + junk filter) ──────────────

/** CoinGecko platform ids for the chains we import from. */
export type CgPlatform = "ethereum" | "solana";

/** CoinGecko coin id for a chain's native asset (used to price BTC/ETH/SOL). */
export const NATIVE_COIN_ID: Record<string, string> = {
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  solana: "solana",
};

/**
 * True if we can live-price this bare symbol on the investments page (i.e. it's
 * in the curated map, so `getCryptoQuotes` will resolve `${SYM}-USD`). Wallet
 * sync stores these as tickered holdings (live day-change); everything else is
 * stored as a fixed-value snapshot.
 */
export function hasCuratedSymbol(symbol: string): boolean {
  return Boolean(SYMBOL_TO_ID[symbol.trim().toUpperCase()]);
}

export type CoinRef = { id: string; symbol: string };

// The full contract→coin map is ~2.7MB and rarely changes. Cache it in-module
// with a TTL so a wallet sync makes at most one heavy fetch per window.
let contractMapCache: { at: number; map: Record<CgPlatform, Map<string, CoinRef>> } | null = null;
const CONTRACT_MAP_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Build a `contract address → {coin id, symbol}` map per chain from CoinGecko's
 * coin list. Membership is the junk filter: a token CoinGecko doesn't track (no
 * real market) simply isn't in the map and gets dropped during wallet sync.
 * Contract keys are lower-cased for case-insensitive matching (Solana mints are
 * case-sensitive base58, but lower-casing both sides stays consistent).
 */
export async function getContractIdMap(): Promise<Record<CgPlatform, Map<string, CoinRef>>> {
  if (contractMapCache && Date.now() - contractMapCache.at < CONTRACT_MAP_TTL_MS) {
    return contractMapCache.map;
  }
  const empty: Record<CgPlatform, Map<string, CoinRef>> = {
    ethereum: new Map(),
    solana: new Map(),
  };
  const key = coingeckoKey();
  try {
    const res = await fetch(`${BASE}/coins/list?include_platform=true`, {
      cache: "no-store",
      headers: key ? { "x-cg-demo-api-key": key } : {},
    });
    if (!res.ok) return contractMapCache?.map ?? empty;
    const coins = (await res.json()) as Array<{
      id: string;
      symbol: string;
      platforms?: Record<string, string | null>;
    }>;
    for (const c of coins) {
      const ref: CoinRef = { id: c.id, symbol: (c.symbol ?? "").toUpperCase() };
      for (const platform of ["ethereum", "solana"] as const) {
        const contract = c.platforms?.[platform];
        if (contract) empty[platform].set(contract.toLowerCase(), ref);
      }
    }
    contractMapCache = { at: Date.now(), map: empty };
    return empty;
  } catch {
    return contractMapCache?.map ?? empty;
  }
}

export type UsdPrice = { price: number; change24h: number | null };

/**
 * Fetch current USD prices (+ 24h change) for CoinGecko coin ids, batched.
 * Returns a map keyed by coin id; ids CoinGecko can't price are omitted.
 */
export async function getUsdPricesByIds(ids: string[]): Promise<Record<string, UsdPrice>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const key = coingeckoKey();
  const out: Record<string, UsdPrice> = {};
  // /simple/price handles many ids per call; chunk conservatively for URL length.
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const url =
      `${BASE}/simple/price?ids=${encodeURIComponent(chunk.join(","))}` +
      `&vs_currencies=usd&include_24hr_change=true`;
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: key ? { "x-cg-demo-api-key": key } : {},
      });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<
        string,
        { usd?: number; usd_24h_change?: number }
      >;
      for (const [id, row] of Object.entries(data)) {
        if (typeof row.usd === "number" && row.usd > 0) {
          out[id] = {
            price: row.usd,
            change24h: typeof row.usd_24h_change === "number" ? row.usd_24h_change : null,
          };
        }
      }
    } catch {
      // skip this chunk
    }
  }
  return out;
}
