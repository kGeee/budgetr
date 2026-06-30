import { NextRequest, NextResponse } from "next/server";
import { getQuotes, finnhubToken, hasFinnhubKey } from "@/lib/finnhub";

export const dynamic = "force-dynamic";

/**
 * GET /api/prices?symbols=AAPL,MSFT
 *
 * Returns an initial quote snapshot plus the WebSocket token the client uses to
 * open Finnhub's real-time trade stream. The token is intentionally returned to
 * the browser: Finnhub's WS auth puts the token in the connection URL, so it is
 * inherently client-visible. budgetr is a local, single-user app, so this is an
 * acceptable trade-off. (For a multi-tenant deployment you'd proxy the WS.)
 */
export async function GET(req: NextRequest) {
  const symbols = (req.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!hasFinnhubKey()) {
    return NextResponse.json({ enabled: false, quotes: {}, wsToken: null });
  }

  const quotes = await getQuotes(symbols);
  return NextResponse.json({ enabled: true, quotes, wsToken: finnhubToken() });
}
