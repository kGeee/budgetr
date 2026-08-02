import { PageHead } from "@/components/page-head";
import { OptionsToolTabs } from "@/components/investments-tabs";
import { OptionsPositionsView } from "@/components/options/options-positions-view";
import { LivePricesProvider } from "@/components/live-prices";
import type { HoldingRow } from "@/components/portfolio-view";
import { getHoldings, getInvestmentSectors, sectorKeyFor } from "@/lib/queries";
import { parseOccSymbol } from "@/lib/options";
import { loadOptionChainContext } from "@/lib/options-desk";

export const dynamic = "force-dynamic";
// Holdings come from the DB (always fresh); the chain fetches should ride the
// 30m Data Cache rather than being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

/**
 * Options › Positions — where the Options desk opens.
 *
 * Your book first (what's open, what's at risk, what expires this week), then
 * the four tools. Before this desk existed the only way into any options tool
 * was a chip on a holding row, so a portfolio with no option legs had no path in
 * at all.
 */
export default async function OptionsPositionsPage() {
  const sectors = getInvestmentSectors();
  const legs: HoldingRow[] = getHoldings()
    .filter((h) => parseOccSymbol(h.ticker))
    .map((h) => {
      const sectorKey = sectorKeyFor(h.ticker, h.id);
      return { ...h, sectorKey, sector: sectors[sectorKey] ?? null } as HoldingRow;
    });

  const chain = await loadOptionChainContext(legs.map((h) => h.ticker));

  // The underlyings, for live quotes — the chain's spot is a fallback when the
  // market is closed or the symbol has no Finnhub coverage.
  const underlyings = [
    ...new Set(legs.map((h) => parseOccSymbol(h.ticker)?.underlying).filter((u): u is string => !!u)),
  ];

  return (
    <div className="space-y-7">
      <OptionsToolTabs />
      <PageHead title="Options" />
      <LivePricesProvider symbols={underlyings}>
        <OptionsPositionsView
          legs={legs}
          ivByOcc={chain.ivByOcc}
          underlyingPrices={chain.underlyingPrices}
          chainByUnderlying={chain.chainByUnderlying}
        />
      </LivePricesProvider>
    </div>
  );
}
