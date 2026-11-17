import { FixedStrikeVolView, type VolToday } from "@/components/options/fixed-strike-vol-view";
import { buildIvSurface, ivTermStructure, volatilitySmile } from "@/lib/option-chain-analytics";
import type { OptionQuote } from "@/lib/yahoo";
import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain } from "@/lib/yahoo";
import { getQuotes } from "@/lib/finnhub";
import { after } from "next/server";
import { captureIvSnapshots, loadIvSnapshots } from "@/lib/fixed-strike-vol";

/** Chain › Vol — implied vol per fixed strike, over time (was /options/vol). */
export async function VolMode({ ticker }: { ticker: string }) {
  // This mode *does* read the tape back, so the ordering matters: read first,
  // then refresh after the response. Today's capture therefore lands in time
  // for the next visit rather than the current one — the surface is a 30-day
  // history, so a same-day point arriving one visit later is invisible, and
  // it's worth not making every visit wait on a few thousand-row upsert.
  const chain = (await getCboeOptionChain(ticker, [])) ?? (await getOptionChain(ticker, []));
  const snapshot = await getQuotes([ticker]);
  const spot = snapshot[ticker]?.price ?? null;
  const rows = loadIvSnapshots(ticker);
  if (chain) after(() => captureIvSnapshots(ticker, chain, spot));

  return (
    <FixedStrikeVolView
      ticker={ticker}
      rows={rows}
      spot={spot ?? chain?.underlyingPrice ?? null}
      today={chain ? summariseToday(chain.contracts, spot ?? chain.underlyingPrice ?? null) : null}
    />
  );
}

/** Strikes kept each side of spot — enough to read the skew, small enough to ship. */
const SURFACE_WINDOW = 8;
const SMILE_WINDOW = 20;

/**
 * Today's chain reduced to what the Vol page draws: the IV grid per side, ATM
 * IV by expiry, and a near-spot smile per expiry. Done here because a whole
 * chain is megabytes and this view needs a few hundred numbers of it.
 */
function summariseToday(contracts: OptionQuote[], spot: number | null): VolToday {
  const term = ivTermStructure(contracts, spot).flatMap((t) =>
    t.atmIv != null && t.dte >= 0 ? [{ expiry: t.expiry, dte: t.dte, atmIv: t.atmIv }] : [],
  );
  const smiles: VolToday["smiles"] = {};
  for (const t of term) {
    let points = volatilitySmile(contracts, t.expiry, spot);
    if (spot != null && points.length > SMILE_WINDOW * 2 + 1) {
      let ci = 0;
      for (let i = 0; i < points.length; i++) {
        if (Math.abs(points[i].strike - spot) < Math.abs(points[ci].strike - spot)) ci = i;
      }
      points = points.slice(Math.max(0, ci - SMILE_WINDOW), ci + SMILE_WINDOW + 1);
    }
    smiles[t.expiry] = points.map((p) => ({ strike: p.strike, callIv: p.callIv, putIv: p.putIv }));
  }
  return {
    surfaces: {
      mid: buildIvSurface(contracts, spot, { side: "mid", strikeWindow: SURFACE_WINDOW }),
      call: buildIvSurface(contracts, spot, { side: "call", strikeWindow: SURFACE_WINDOW }),
      put: buildIvSurface(contracts, spot, { side: "put", strikeWindow: SURFACE_WINDOW }),
    },
    term,
    smiles,
  };
}
