import { FixedStrikeVolView } from "@/components/options/fixed-strike-vol-view";
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

  return <FixedStrikeVolView ticker={ticker} rows={rows} />;
}
