/**
 * SEC EDGAR "companyfacts" — free, no API key, complete US-filer financials.
 *
 *   ticker → CIK:  https://www.sec.gov/files/company_tickers.json
 *   facts:         https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 *
 * SEC requires a descriptive User-Agent with contact info. Cached in Next's Data
 * Cache (24h) — filings change quarterly at most. Degrades to null on any failure.
 */
import {
  parseIncomeStatement,
  type CompanyFacts,
  type IncomeStatement,
  type Period,
} from "@/lib/fundamentals/income-statement";

const UA = "budgetr personal-finance (kegeorge246@gmail.com)";
const DAY = 86_400;

let tickerMap: Map<string, string> | null = null;

/** Resolve a ticker to its zero-padded 10-digit CIK (e.g. AAPL → 0000320193). */
export async function resolveCik(ticker: string): Promise<string | null> {
  const sym = ticker.trim().toUpperCase();
  if (!tickerMap) {
    try {
      const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: { "User-Agent": UA },
        next: { revalidate: 7 * DAY },
      });
      if (!res.ok) return null;
      const j = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
      tickerMap = new Map();
      for (const row of Object.values(j)) {
        tickerMap.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
      }
    } catch {
      return null;
    }
  }
  return tickerMap.get(sym) ?? null;
}

/** Fetch a company's full XBRL facts, or null if unavailable. */
export async function fetchCompanyFacts(ticker: string): Promise<CompanyFacts | null> {
  const cik = await resolveCik(ticker);
  if (!cik) return null;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA },
      next: { revalidate: DAY },
    });
    if (!res.ok) return null;
    return (await res.json()) as CompanyFacts;
  } catch {
    return null;
  }
}

/** The latest income statement for a ticker (annual or quarterly), or null. */
export async function getIncomeStatement(
  ticker: string,
  period: Period = "annual",
): Promise<IncomeStatement | null> {
  const facts = await fetchCompanyFacts(ticker);
  return facts ? parseIncomeStatement(facts, period) : null;
}
