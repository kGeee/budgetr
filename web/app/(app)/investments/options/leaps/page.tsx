import { PageHead } from "@/components/page-head";
import { Card } from "@/components/ui/card";
import { OptionsToolTabs } from "@/components/investments-tabs";
import { TickerSwitcher } from "@/components/ticker-switcher";
import { LeapsView } from "@/components/options/leaps-view";
import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain } from "@/lib/yahoo";
import { getQuotes, getBasicFinancials } from "@/lib/finnhub";
import { daysToExpiry } from "@/lib/options";
import { analyzeChainForLeaps, LEAPS_MIN_DTE } from "@/lib/quant/leaps";
import { RISK_FREE_RATE } from "@/lib/quant/greeks";

export const dynamic = "force-dynamic";
// Holdings are fresh from the DB, but the chain fetch should still hit the 30m
// Data Cache rather than being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

/**
 * Options › LEAPS — one long-dated call against 100 shares.
 *
 * Symbol-scoped and carried in `?ticker=`, like Chain and Vol, so a name can
 * travel between the tools unchanged.
 *
 * A typical margin rate for a retail account. It's a comparison benchmark, not
 * a quote — the point is whether the option is financing the position cheaper
 * or dearer than a broker would, and being roughly right is enough to answer
 * that. Overridable per-request while there's no settings row for it.
 */
const DEFAULT_MARGIN_RATE = 0.09;

export default async function LeapsPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string; margin?: string }>;
}) {
  const { ticker: raw, margin } = await searchParams;
  const ticker = (raw ?? "").trim().toUpperCase();

  if (!ticker) {
    return (
      <div className="space-y-7">
        <OptionsToolTabs />
        <PageHead title="LEAPS" />
        <Card>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Pick a symbol to compare a long-dated call against owning the shares — what the
            leverage costs, what it frees up, and where each position wins.
          </p>
          <TickerSwitcher action="/investments/options/leaps" />
        </Card>
      </div>
    );
  }

  // Whole chain (no expiry filter) — LEAPS live at the far end of it, so a
  // filtered fetch would be the one thing guaranteed to miss them.
  const chain = (await getCboeOptionChain(ticker, [])) ?? (await getOptionChain(ticker, []));

  const [snapshot, financials] = await Promise.all([
    getQuotes([ticker]),
    getBasicFinancials([ticker]),
  ]);
  const spot = snapshot[ticker]?.price ?? chain?.underlyingPrice ?? null;

  // Finnhub quotes dividend yield in percent; the maths wants a decimal. Null
  // when there's no key configured, in which case the view says so rather than
  // quietly treating the stock as paying nothing — forgone dividends are a real
  // part of this tradeoff and a silent zero would flatter the option.
  const rawYield = financials[ticker]?.dividendYield ?? null;
  const dividendYield = rawYield == null ? null : rawYield / 100;

  const marginRate = (() => {
    const parsed = Number(margin);
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_MARGIN_RATE;
  })();

  const candidates =
    chain && spot != null
      ? analyzeChainForLeaps(chain.contracts, {
          spot,
          dteFor: (expiry) => daysToExpiry(expiry),
          dividendYield,
          rate: RISK_FREE_RATE,
          marginRate,
        })
      : [];

  return (
    <div className="space-y-7">
      <OptionsToolTabs ticker={ticker} />
      <PageHead
        title="LEAPS"
        action={<TickerSwitcher action="/investments/options/leaps" ticker={ticker} />}
      />

      {spot == null ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No live price for {ticker}, so there&rsquo;s nothing to compare the calls against.
            Check the symbol, or try again when the market data provider is reachable.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
            <span>
              <span className="text-[var(--paper)]">{ticker}</span> at{" "}
              <span className="tabular text-[var(--paper)]">${spot.toFixed(2)}</span>
            </span>
            <span>· calls {LEAPS_MIN_DTE}+ days out</span>
            <span>· cash at {(RISK_FREE_RATE * 100).toFixed(1)}%</span>
            <span>· margin benchmark {(marginRate * 100).toFixed(1)}%</span>
          </div>

          <LeapsView
            ticker={ticker}
            spot={spot}
            candidates={candidates}
            dividendYield={dividendYield}
            rate={RISK_FREE_RATE}
            marginRate={marginRate}
          />
        </>
      )}
    </div>
  );
}
