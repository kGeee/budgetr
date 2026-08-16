import { PageHead } from "@/components/page-head";
import { Card } from "@/components/ui/card";
import { OptionsToolTabs } from "@/components/investments-tabs";
import { FundamentalsHandoff, TickerSwitcher } from "@/components/ticker-switcher";
import { FixedStrikeVolView } from "@/components/fixed-strike-vol-view";
import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain } from "@/lib/yahoo";
import { getQuotes } from "@/lib/finnhub";
import { after } from "next/server";
import { captureIvSnapshots, loadIvSnapshots } from "@/lib/fixed-strike-vol";

export const dynamic = "force-dynamic";
// Chain fetches ride the 30m Data Cache; snapshots persist once per day.
export const fetchCache = "default-cache";

/**
 * Options › Vol — implied vol per fixed strike, over time.
 *
 * Symbol-scoped like the chain, and by the same means (`?ticker=`), so moving
 * between the two keeps the symbol.
 */
export default async function FixedStrikeVolPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker: raw } = await searchParams;
  const ticker = (raw ?? "").trim().toUpperCase();

  if (!ticker) {
    return (
      <div className="space-y-7">
        <OptionsToolTabs />
        <PageHead
          title="Fixed-strike vol"
          action={<TickerSwitcher action="/investments/options/vol" />}
        />
        <Card className="p-6 text-sm text-[var(--muted)]">
          Pick a symbol to see how each strike&rsquo;s implied vol has moved. History builds up
          from the day you first open a chain for it — budgetr captures one snapshot per
          symbol per day.
        </Card>
      </div>
    );
  }

  // This page *does* read the tape back, so the ordering matters: read first,
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
    <div className="space-y-7">
      <OptionsToolTabs ticker={ticker} />
      <PageHead
        title={`${ticker} fixed-strike vol`}
        action={
          <div className="flex flex-wrap items-center gap-4">
            <FundamentalsHandoff ticker={ticker} />
            <TickerSwitcher action="/investments/options/vol" ticker={ticker} />
          </div>
        }
      />
      <FixedStrikeVolView ticker={ticker} rows={rows} />
    </div>
  );
}
