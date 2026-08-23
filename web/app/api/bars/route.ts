import { NextRequest, NextResponse } from "next/server";
import { getBarsFor, type BarInterval, type BarRange } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
// Yahoo fetches should hit Next's Data Cache (getBars sets its own revalidate),
// not be forced no-store by the route being dynamic.
export const fetchCache = "default-cache";

const INTERVALS: BarInterval[] = ["5m", "15m", "30m", "1h", "1d", "1wk", "1mo"];
const RANGES: BarRange[] = ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"];

/** At most this many symbols per request — the desk's grid never shows more. */
const MAX_SYMBOLS = 24;

/**
 * GET /api/bars?symbols=AAPL,MSFT&range=6mo&interval=1d
 *
 * OHLCV bars for the markets desk, so switching timeframe or adding a symbol is
 * a fetch rather than a full server round-trip through the page. The Hull study
 * is computed client-side from these bars — the indicator is pure math over the
 * same array the candles are drawn from, so shipping it separately would only
 * risk the two disagreeing.
 *
 * Unknown symbols come back as an empty `bars` array rather than an error, which
 * is what lets the watchlist show a "no data" tile instead of failing the batch.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const symbols = (p.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) return NextResponse.json({ series: {} });

  const interval = (INTERVALS as string[]).includes(p.get("interval") ?? "")
    ? (p.get("interval") as BarInterval)
    : "1d";
  const range = (RANGES as string[]).includes(p.get("range") ?? "")
    ? (p.get("range") as BarRange)
    : "6mo";

  const series = await getBarsFor(symbols, range, interval);
  return NextResponse.json({ range, interval, series });
}
