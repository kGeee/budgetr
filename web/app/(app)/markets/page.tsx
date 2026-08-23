import { PageHead } from "@/components/page-head";
import { InvestmentsTabs } from "@/components/investments-tabs";
import { MarketsView } from "@/components/markets/markets-view";
import { getMarketsPrefs, getWatchlist } from "@/lib/watchlist";
import { getBarsFor } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
// The watchlist comes from the DB (must be fresh), but the Yahoo bar fetches
// should still hit Next's Data Cache rather than be forced no-store by it.
export const fetchCache = "default-cache";

export const metadata = { title: "Markets — budgetr" };

/**
 * The markets desk: every watched ticker charted with the Hull Suite, and a rail
 * that says which way each one is pointing and how long it has been pointing
 * that way.
 *
 * Server-rendered with the first timeframe's bars already fetched so the grid
 * paints with data; every subsequent timeframe change is a client fetch against
 * /api/bars. Lives outside `investments/layout.tsx`, so it renders the section
 * tab bar itself — same arrangement as Fundamentals.
 */
export default async function MarketsPage() {
  const [symbols, prefs] = [getWatchlist(), getMarketsPrefs()];
  const series = await getBarsFor(symbols, prefs.range, prefs.interval);

  return (
    <div className="space-y-6">
      <InvestmentsTabs />
      <PageHead
        title="Markets"
        action={
          <p className="max-w-xs text-right text-xs text-[var(--muted)]">
            Hull Suite over every watched symbol — one indicator, one read.
          </p>
        }
      />
      <MarketsView symbols={symbols} series={series} prefs={prefs} />
    </div>
  );
}
