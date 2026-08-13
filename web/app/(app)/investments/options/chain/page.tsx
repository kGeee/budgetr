import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { Card } from "@/components/ui/card";
import { OptionsToolTabs } from "@/components/investments-tabs";
import { FundamentalsHandoff, TickerSwitcher } from "@/components/ticker-switcher";
import { OptionsChainView } from "@/components/options-chain-view";
import { LivePricesProvider } from "@/components/live-prices";
import type { HoldingRow } from "@/components/portfolio-view";
import { getHoldings, getInvestmentSectors, sectorKeyFor } from "@/lib/queries";
import { parseOccSymbol } from "@/lib/options";
import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain } from "@/lib/yahoo";
import { getQuotes } from "@/lib/finnhub";
import { after } from "next/server";
import { captureIvSnapshots } from "@/lib/fixed-strike-vol";

export const dynamic = "force-dynamic";
// Holdings come from the DB (fresh), but the option-chain fetch should hit the
// 30m Data Cache rather than being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

/**
 * Options › Chain — the full listed chain for one symbol.
 *
 * The symbol lives in `?ticker=` rather than the path, so the desk works for any
 * listed name instead of only the ones you already hold a leg in (the old
 * `/investments/options/[ticker]` route could only be reached from a holding
 * row, which made an unheld ticker impossible to look at), and so the symbol can
 * travel to Vol and Fundamentals unchanged.
 */
export default async function OptionsChainPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker: raw } = await searchParams;
  const ticker = (raw ?? "").trim().toUpperCase();

  const sectors = getInvestmentSectors();
  const holdings = getHoldings();

  if (!ticker) return <PickSymbol holdings={holdings} />;

  // The full chain — every listed expiry + strike (weeklies and all). CBOE is
  // primary (real Greeks, no auth); Yahoo is a best-effort fallback. Passing no
  // expiries returns the whole chain.
  const chain = (await getCboeOptionChain(ticker, [])) ?? (await getOptionChain(ticker, []));

  // Your OCC-tickered legs on this underlying, mapped into HoldingRow so the
  // positions panel can reuse the existing OptionsAnalytics component.
  const heldLegs: HoldingRow[] = holdings
    .map((h) => {
      const sectorKey = sectorKeyFor(h.ticker, h.id);
      return { ...h, sectorKey, sector: sectors[sectorKey] ?? null } as HoldingRow;
    })
    .filter((h) => parseOccSymbol(h.ticker)?.underlying === ticker);

  // Live underlying snapshot (works when the market is closed too).
  const snapshot = await getQuotes([ticker]);
  const snapshotPrice = snapshot[ticker]?.price ?? null;

  // The capture is a few thousand-row upsert and nothing on this page reads it
  // back — the Vol tool does, on its own visit. Running it inline made the desk
  // wait on a write it doesn't need, so it now runs after the response is sent.
  // Behaviour is otherwise unchanged: history still builds from desk visits,
  // and the per-day unique key keeps repeats idempotent.
  if (chain) after(() => captureIvSnapshots(ticker, chain, snapshotPrice));

  const currency = heldLegs[0]?.currency ?? "USD";

  return (
    <div className="space-y-7">
      <OptionsToolTabs ticker={ticker} />
      <PageHead
        title={`${ticker} options`}
        action={
          <div className="flex flex-wrap items-center gap-4">
            <FundamentalsHandoff ticker={ticker} />
            <TickerSwitcher action="/investments/options/chain" ticker={ticker} />
          </div>
        }
      />
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
    </div>
  );
}

/**
 * Landing state with no symbol chosen. Offers the underlyings you already have
 * legs in, then the equities and ETFs you hold — the two lists a person is most
 * likely to want a chain for.
 */
function PickSymbol({ holdings }: { holdings: ReturnType<typeof getHoldings> }) {
  const held = [
    ...new Set(
      holdings.map((h) => parseOccSymbol(h.ticker)?.underlying).filter((u): u is string => !!u),
    ),
  ];
  const optionable = [
    ...new Set(
      holdings
        .filter((h) => h.ticker && !parseOccSymbol(h.ticker))
        .filter((h) => h.securityType === "equity" || h.securityType === "etf")
        .map((h) => h.ticker as string),
    ),
  ].filter((t) => !held.includes(t));

  return (
    <div className="space-y-7">
      <OptionsToolTabs />
      <PageHead
        title="Options chain"
        action={<TickerSwitcher action="/investments/options/chain" />}
      />
      <Card className="p-6">
        <p className="text-sm text-[var(--muted)]">
          Enter any listed symbol above — you don&rsquo;t need to hold it.
        </p>
        {held.length > 0 && (
          <SymbolRow label="You have legs in" symbols={held} />
        )}
        {optionable.length > 0 && (
          <SymbolRow label="You hold" symbols={optionable.slice(0, 12)} />
        )}
      </Card>
    </div>
  );
}

function SymbolRow({ label, symbols }: { label: string; symbols: string[] }) {
  return (
    <div className="mt-5">
      <p className="eyebrow">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {symbols.map((s) => (
          <Link
            key={s}
            href={`/investments/options/chain?ticker=${encodeURIComponent(s)}`}
            className="mono rounded-full border border-line px-3 py-1.5 text-sm text-[var(--paper)] transition hover:border-[var(--brass-dim)] hover:text-[var(--brass)]"
          >
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}
