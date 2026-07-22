/**
 * Wheel-scanner data layer — assembles the scan universe, fans out option-chain
 * fetches (CBOE → Yahoo fallback, concurrency-capped and Data-Cache-friendly),
 * gathers next-earnings dates and IV rank, and runs the pure scanner
 * (lib/wheel-scanner.ts) over each ticker. Returns one serializable payload for
 * the /investments/options/scanner page.
 */

import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain } from "@/lib/yahoo";
import { getEarningsCalendar } from "@/lib/finnhub";
import { getHoldings } from "@/lib/queries";
import { parseOccSymbol } from "@/lib/options";
import { getIvRank } from "@/lib/iv-rank";
import { captureIvSnapshots } from "@/lib/fixed-strike-vol";
import {
  scanPutsForTicker,
  DEFAULT_CRITERIA,
  type ScanCriteria,
  type PutCandidate,
} from "@/lib/wheel-scanner";

/**
 * A curated set of liquid, optionable large-caps and ETFs — names that reliably
 * have tight, deep option markets to run the wheel on. Union'd with whatever you
 * already hold so the scan always covers your book plus a broad hunting ground.
 */
export const CURATED_UNIVERSE: string[] = [
  // Index / sector ETFs
  "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "SMH", "GLD", "SLV", "TLT", "ARKK",
  // Mega-cap tech
  "AAPL", "MSFT", "NVDA", "AMD", "GOOGL", "AMZN", "META", "NFLX", "AVGO", "TSLA", "INTC", "MU", "CRM", "ORCL", "ADBE",
  // Financials / consumer / health
  "JPM", "BAC", "WFC", "GS", "V", "MA", "KO", "PEP", "PG", "JNJ", "UNH", "HD", "WMT", "COST", "DIS", "MCD",
  // Energy / industrials
  "XOM", "CVX", "CAT", "BA", "GE",
  // High-IV / retail favorites
  "PLTR", "SOFI", "COIN", "UBER", "ABNB", "SHOP", "F", "T",
];

export type ScanResult = {
  candidates: PutCandidate[];
  /** Tickers that returned a usable chain. */
  scanned: number;
  /** The full universe attempted. */
  universe: string[];
  criteria: ScanCriteria;
  /** Whether a Finnhub key was available for earnings flags. */
  earningsAvailable: boolean;
  asOf: string;
};

/** Held equity tickers + underlyings of held option contracts. */
function heldUnderlyings(): string[] {
  const out = new Set<string>();
  for (const h of getHoldings()) {
    const t = h.ticker?.trim().toUpperCase();
    if (!t) continue;
    const parsed = parseOccSymbol(t);
    if (parsed) out.add(parsed.underlying);
    else if (/^[A-Z.]{1,6}$/.test(t)) out.add(t); // plausible equity ticker
  }
  return [...out];
}

/** Curated names ∪ your holdings, de-duped and upper-cased. */
export function buildUniverse(extra: string[] = []): string[] {
  return [
    ...new Set(
      [...CURATED_UNIVERSE, ...heldUnderlyings(), ...extra].map((s) => s.trim().toUpperCase()).filter(Boolean),
    ),
  ].sort();
}

/** Run async `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type ScanOptions = {
  criteria?: ScanCriteria;
  universe?: string[];
  /** Max candidates returned (after ranking). */
  limit?: number;
  /** Persist today's IV surface for each scanned ticker (slower; bootstraps IV rank). */
  capture?: boolean;
};

/**
 * Scan the universe for cash-secured-put candidates. Chains are fetched
 * concurrently (capped) and cached 30m, so repeat scans within the window are
 * cheap. IV rank is read from the snapshot tape where history exists.
 */
export async function scanWheelPuts(opts: ScanOptions = {}): Promise<ScanResult> {
  const criteria = opts.criteria ?? DEFAULT_CRITERIA;
  const universe = opts.universe ?? buildUniverse();
  const limit = opts.limit ?? 60;

  // One earnings call for the whole window covers every ticker.
  const earnings = await getEarningsCalendar();
  const earningsAvailable = Object.keys(earnings).length > 0;

  const chains = await mapLimit(universe, 8, async (ticker) => {
    const chain = (await getCboeOptionChain(ticker, [])) ?? (await getOptionChain(ticker, []));
    return { ticker, chain };
  });

  const now = new Date();
  const all: PutCandidate[] = [];
  let scanned = 0;

  for (const { ticker, chain } of chains) {
    if (!chain) continue;
    scanned += 1;
    const spot = chain.underlyingPrice;
    if (opts.capture && spot != null) {
      try {
        captureIvSnapshots(ticker, chain, spot);
      } catch {
        /* capture is best-effort */
      }
    }
    const ivRank = getIvRank(ticker);
    const candidates = scanPutsForTicker(
      { ticker, chain, spot, ivRank, earningsDate: earnings[ticker] ?? null },
      criteria,
      now,
    );
    all.push(...candidates);
  }

  all.sort((a, b) => b.score - a.score);

  return {
    candidates: all.slice(0, limit),
    scanned,
    universe,
    criteria,
    earningsAvailable,
    asOf: now.toISOString(),
  };
}
