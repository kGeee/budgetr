import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { OptionsChainView } from "@/components/options-chain-view";
import { LivePricesProvider } from "@/components/live-prices";
import type { HoldingRow } from "@/components/portfolio-view";
import { getHoldings, getInvestmentSectors, sectorKeyFor } from "@/lib/queries";
import { parseOccSymbol } from "@/lib/options";
import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain } from "@/lib/yahoo";
import { getQuotes } from "@/lib/finnhub";
import { captureIvSnapshots } from "@/lib/fixed-strike-vol";

export const dynamic = "force-dynamic";
// Holdings come from the DB (fresh), but the option-chain fetch should hit the
// 30m Data Cache rather than being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

export default async function OptionsTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).trim().toUpperCase();

  // The full chain — every listed expiry + strike (weeklies and all). CBOE is
  // primary (real Greeks, no auth); Yahoo is a best-effort fallback. Passing no
  // expiries returns the whole chain.
  const chain = (await getCboeOptionChain(ticker, [])) ?? (await getOptionChain(ticker, []));

  // Your OCC-tickered option legs on this underlying, mapped into HoldingRow so
  // the positions panel can reuse the existing OptionsAnalytics component.
  const sectors = getInvestmentSectors();
  const heldLegs: HoldingRow[] = getHoldings()
    .map((h) => {
      const sectorKey = sectorKeyFor(h.ticker, h.id);
      return { ...h, sectorKey, sector: sectors[sectorKey] ?? null } as HoldingRow;
    })
    .filter((h) => parseOccSymbol(h.ticker)?.underlying === ticker);

  // Live underlying snapshot (works when the market is closed too).
  const snapshot = await getQuotes([ticker]);
  const snapshotPrice = snapshot[ticker]?.price ?? null;

  // Every desk visit refreshes today's fixed-strike vol capture (idempotent
  // per day) — the history tape behind /options/[ticker]/fixed-strike.
  if (chain) captureIvSnapshots(ticker, chain, snapshotPrice);

  const currency = heldLegs[0]?.currency ?? "USD";

  return (
    <div className="space-y-7">
      <PageHead
        title={`${ticker} options`}
        action={
          <span className="flex items-center gap-4">
            <Link
              href={`/investments/options/${encodeURIComponent(ticker)}/fixed-strike`}
              className="inline-flex items-center gap-1.5 text-sm text-[var(--brass)] transition-colors hover:text-[var(--paper)]"
            >
              Fixed-strike vol
            </Link>
            <Link
              href="/investments"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
            >
              <ArrowLeft size={15} />
              Investments
            </Link>
          </span>
        }
      />
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
    </div>
  );
}
