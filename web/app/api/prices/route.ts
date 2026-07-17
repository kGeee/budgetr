import { NextRequest, NextResponse } from "next/server";
import { getQuotes, finnhubToken, hasFinnhubKey } from "@/lib/finnhub";
import { getCryptoQuotes, isCryptoSymbol } from "@/lib/coingecko";

export const dynamic = "force-dynamic";

/**
 * GET /api/prices?symbols=AAPL,MSFT,BTC-USD
 *
 * Returns an initial quote snapshot plus the WebSocket token the client uses to
 * open Finnhub's real-time trade stream. The token is intentionally returned to
 * the browser: Finnhub's WS auth puts the token in the connection URL, so it is
 * inherently client-visible. budgetr is a local, single-user app, so this is an
 * acceptable trade-off. (For a multi-tenant deployment you'd proxy the WS.)
 *
 * Symbols are split across two feeds: `*-USD` crypto pairs go to CoinGecko
 * (which also gives them a day change), everything else to Finnhub. `enabled`
 * reflects Finnhub live streaming; crypto quotes are returned regardless so a
 * crypto-only portfolio still shows priced holdings.
 */
export async function GET(req: NextRequest) {
  const symbols = (req.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const cryptoSymbols = symbols.filter(isCryptoSymbol);
  const equitySymbols = symbols.filter((s) => !isCryptoSymbol(s));

  const [equityQuotes, cryptoQuotes] = await Promise.all([
    hasFinnhubKey() ? getQuotes(equitySymbols) : Promise.resolve({}),
    getCryptoQuotes(cryptoSymbols),
  ]);

  return NextResponse.json({
    enabled: hasFinnhubKey(),
    quotes: { ...equityQuotes, ...cryptoQuotes },
    wsToken: finnhubToken() ?? null,
  });
}
