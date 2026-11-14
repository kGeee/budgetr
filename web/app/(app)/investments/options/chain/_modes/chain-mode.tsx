import { Card } from "@/components/ui/card";
import { OptionsChainView } from "@/components/options/options-chain-view";
import { LivePricesProvider } from "@/components/portfolio/live-prices";
import type { HoldingRow } from "@/components/portfolio/valuation";
import { getHoldings, getInvestmentSectors, sectorKeyFor } from "@/lib/queries";
import { parseOccSymbol } from "@/lib/options";
import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain } from "@/lib/yahoo";
import { getQuotes } from "@/lib/finnhub";
import { after } from "next/server";
import { captureIvSnapshots } from "@/lib/fixed-strike-vol";

/** Chain › Chain — the full listed chain for one symbol. */
export async function ChainMode({ ticker }: { ticker: string }) {
  const sectors = getInvestmentSectors();

  // The full chain — every listed expiry + strike (weeklies and all). CBOE is
  // primary (real Greeks, no auth); Yahoo is a best-effort fallback. Passing no
  // expiries returns the whole chain.
  const chain = (await getCboeOptionChain(ticker, [])) ?? (await getOptionChain(ticker, []));

  // Your OCC-tickered legs on this underlying, mapped into HoldingRow so the
  // positions panel can reuse the existing OptionsAnalytics component.
  const heldLegs: HoldingRow[] = getHoldings()
    .map((h) => {
      const sectorKey = sectorKeyFor(h.ticker, h.id);
      return { ...h, sectorKey, sector: sectors[sectorKey] ?? null } as HoldingRow;
    })
    .filter((h) => parseOccSymbol(h.ticker)?.underlying === ticker);

  // Live underlying snapshot (works when the market is closed too).
  const snapshot = await getQuotes([ticker]);
  const snapshotPrice = snapshot[ticker]?.price ?? null;

  // The capture is a few thousand-row upsert and nothing in this mode reads it
  // back — Vol does, on its own visit. Running it inline made the desk wait on
  // a write it doesn't need, so it runs after the response is sent. History
  // still builds from desk visits, and the per-day unique key keeps repeats
  // idempotent.
  if (chain) after(() => captureIvSnapshots(ticker, chain, snapshotPrice));

  const currency = heldLegs[0]?.currency ?? "USD";

  return (
    <>
      {!chain && (
        <Card className="p-6 text-sm text-[var(--muted)]">
          No listed chain came back for <span className="mono text-[var(--paper)]">{ticker}</span>.
          Check the symbol, or try again shortly — chains are cached for 30 minutes and both
          sources can rate-limit.
        </Card>
      )}
      <LivePricesProvider symbols={[ticker]}>
        <OptionsChainView
          ticker={ticker}
          contracts={chain?.contracts ?? []}
          ivByOcc={chain?.ivByOcc ?? {}}
          chainPrice={chain?.underlyingPrice ?? null}
          snapshotPrice={snapshotPrice}
          heldLegs={heldLegs}
          currency={currency}
        />
      </LivePricesProvider>
    </>
  );
}
