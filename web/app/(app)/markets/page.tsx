import { PageHead } from "@/components/page-head";
import { InvestmentsTabs } from "@/components/investments-tabs";
import { MarketsView } from "@/components/markets/markets-view";
import { sourceFor } from "@/lib/markets-prefs";
import { getDesk, getMarketsPrefs, getSymbolSources } from "@/lib/watchlist";
import { getBarsFor } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
// The watchlist comes from the DB (must be fresh), but the Yahoo bar fetches
// should still hit Next's Data Cache rather than be forced no-store by it.
export const fetchCache = "default-cache";

export const metadata = { title: "Markets — budgetr" };

/**
 * The markets desk: every market the portfolio is invested in charted with the
 * Hull Suite, and a rail that says which way each one is pointing and how long
 * it has been pointing that way.
 *
 * The symbol list is derived from holdings on every render rather than stored
 * (see lib/watchlist.ts), so opening a position puts it on the desk. Bars are
 * fetched under each symbol's *source* — the redirect the user picked when a
 * symbol turned out not to chart — and the series is therefore keyed by source,
 * not by display symbol.
 *
 * Server-rendered with the first timeframe's bars already fetched so the grid
 * paints with data; every subsequent timeframe change is a client fetch against
 * /api/bars. Lives outside `investments/layout.tsx`, so it renders the section
 * tab bar itself — same arrangement as Fundamentals.
 */
export default async function MarketsPage() {
  const { symbols, derived } = getDesk();
  const prefs = getMarketsPrefs();
  const sources = getSymbolSources();
  const series = await getBarsFor(
    symbols.map((s) => sourceFor(s, sources)),
    prefs.range,
    prefs.interval,
  );

  return (
    <div className="space-y-6">
      <InvestmentsTabs />
      <PageHead
        title="Markets"
        action={
          <p className="max-w-xs text-right text-xs text-[var(--muted)]">
            Hull Suite over every market you hold — one indicator, one read.
          </p>
        }
      />
      <MarketsView
        symbols={symbols}
        derived={derived}
        sources={sources}
        series={series}
        prefs={prefs}
      />
    </div>
  );
}
