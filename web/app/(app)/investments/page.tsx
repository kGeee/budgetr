import Link from "next/link";
import { Upload } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { PortfolioView, type HoldingRow } from "@/components/portfolio-view";
import {
  getAllocationTargets,
  getAssetClassOverrides,
  getDividendSummary,
  getGeographyOverrides,
  getHoldings,
  getImportedHoldings,
  getInvestmentSectors,
  getInvestmentTransactions,
  getKnownSectors,
  getManualHoldings,
  sectorKeyFor,
} from "@/lib/queries";
import {
  buildReconstructedSeries,
  getTickerHistories,
  type PricePoint,
} from "@/lib/portfolio-history";
import { computeComparison, type BenchmarkKey } from "@/lib/benchmark";
import { parseOccSymbol } from "@/lib/options";
import { getDividendCalendar, getOptionChain, type OptionQuote } from "@/lib/yahoo";
import { getCboeOptionChain } from "@/lib/cboe";

export const dynamic = "force-dynamic";
// Holdings come from the DB (always fresh), but the Yahoo history fetches should
// hit the Data Cache instead of being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

export default async function InvestmentsPage() {
  const plaidHoldingsRaw = getHoldings();
  const transactions = getInvestmentTransactions();
  const manual = getManualHoldings();
  const sectors = getInvestmentSectors();
  const knownSectors = getKnownSectors();
  const allocationTargets = getAllocationTargets();
  const assetClassOverrides = getAssetClassOverrides();
  const geographyOverrides = getGeographyOverrides();
  const dividendSummary = getDividendSummary();

  // Attach the symbol-scoped sector key + its current sector to every Plaid
  // holding so the row carries what the sector editor and allocation need.
  const plaidHoldings: HoldingRow[] = plaidHoldingsRaw.map((h) => {
    const sectorKey = sectorKeyFor(h.ticker, h.id);
    return { ...h, sectorKey, sector: sectors[sectorKey] ?? null };
  });

  // Current positions derived from imported broker trades (source:'import') so
  // they show alongside Plaid holdings and anchor the value curve.
  const importedRaw = getImportedHoldings();

  // Fetch price history for every tickered symbol — Plaid holdings + the
  // symbol-priced manual holdings (e.g. BTC-USD) + imported positions.
  const manualSymbols = manual
    .map((m) => m.symbol)
    .filter((s): s is string => Boolean(s));
  const symbols = [
    // Skip option (OCC) tickers — Yahoo has no history for them.
    ...plaidHoldings
      .map((h) => h.ticker)
      .filter((t): t is string => Boolean(t) && !parseOccSymbol(t)),
    ...manualSymbols,
    ...importedRaw.map((h) => h.ticker).filter((t) => !parseOccSymbol(t)),
  ];
  const histories = await getTickerHistories(symbols);

  // Map manual holdings into the holdings shape. Tickered ones are valued by
  // quantity × price (live → Yahoo last close); fixed-value ones carry their
  // user-set value directly.
  const manualHoldings: HoldingRow[] = manual.map((m) => {
    const sym = m.symbol?.toUpperCase();
    const hist = sym ? histories[sym] : undefined;
    const lastClose = hist && hist.length > 0 ? hist[hist.length - 1].close : null;
    const sectorKey = sectorKeyFor(m.symbol, m.id);
    return {
      id: m.id,
      quantity: m.quantity,
      costBasis: m.costBasis,
      price: null,
      value: m.symbol ? null : m.manualValue, // fixed-value uses manualValue
      closePrice: m.symbol ? lastClose : null,
      currency: m.currency ?? "USD",
      ticker: m.symbol,
      securityName: m.name,
      securityType: m.type,
      // Wallet-imported tokens group under the wallet's label as their own
      // "account"; hand-entered holdings stay under "Manual".
      accountName: m.walletLabel ?? "Manual",
      manual: true,
      fromWallet: Boolean(m.walletId),
      sectorKey,
      sector: sectors[sectorKey] ?? null,
    };
  });

  // Imported positions valued like tickered manual holdings: quantity × last
  // close. Grouped under their import account's name.
  const importedHoldings: HoldingRow[] = importedRaw.map((h) => {
    const sym = h.ticker.toUpperCase();
    const hist = histories[sym];
    const lastClose = hist && hist.length > 0 ? hist[hist.length - 1].close : null;
    const sectorKey = sectorKeyFor(h.ticker, h.id);
    return {
      id: h.id,
      quantity: h.quantity,
      costBasis: h.costBasis,
      price: null,
      value: null,
      closePrice: lastClose,
      currency: h.currency ?? "USD",
      ticker: h.ticker,
      securityName: h.securityName,
      securityType: null,
      accountName: h.accountName ?? "Imported",
      manual: true,
      fromWallet: false,
      sectorKey,
      sector: sectors[sectorKey] ?? null,
    };
  });

  // Interleave manual + imported holdings with Plaid ones, ordered by best-known
  // value so they sort in by size rather than always landing at the bottom. Live
  // prices refine the figure client-side but don't reorder (avoids jumpiness).
  const estValue = (h: HoldingRow): number =>
    h.value ?? (h.price ?? h.closePrice ?? 0) * (h.quantity ?? 0);
  const holdings = [...plaidHoldings, ...manualHoldings, ...importedHoldings].sort(
    (a, b) => estValue(b) - estValue(a),
  );

  // Reconstruct the value curve from the actual buy/sell ledger (anchored to
  // today's holdings) so older days reflect what was really held back then.
  // Manual tickered holdings have no trade ledger, so they ride at constant
  // quantity across the window.
  const trades = transactions
    .filter((t) => t.quantity != null && t.quantity !== 0)
    .map((t) => ({ ticker: t.ticker, date: t.date, quantity: t.quantity }));
  const rawSeries = buildReconstructedSeries(holdings, trades, histories);

  // Fold fixed-value manual assets (no symbol) into the chart as a constant so
  // the portfolio line matches the headline Market value. Tickered manual
  // holdings are already in the series via `holdings`.
  const fixedValueTotal = manual
    .filter((m) => !m.symbol)
    .reduce((s, m) => s + (m.manualValue ?? 0), 0);
  const portfolioSeries =
    fixedValueTotal > 0
      ? rawSeries.map((p) => ({ date: p.date, value: p.value + fixedValueTotal }))
      : rawSeries;

  // Benchmark comparison: pull SPY/QQQ closes (via the shared 6h Yahoo Data
  // Cache) and measure the portfolio's return against them per window. Skipped
  // when there's no portfolio series to compare (empty holdings).
  const benchmarkSeries =
    portfolioSeries.length > 1
      ? await getTickerHistories(["SPY", "QQQ"])
      : ({} as Record<string, PricePoint[]>);
  const benchmarks: Partial<Record<BenchmarkKey, PricePoint[]>> = {
    SPY: benchmarkSeries.SPY,
    QQQ: benchmarkSeries.QQQ,
  };
  const comparison = computeComparison(portfolioSeries, benchmarks);

  // Options analytics: for the distinct OCC underlyings we hold, pull Yahoo's
  // option chains (only when option legs exist) for live IV + underlying prices,
  // fetching just the expiries we actually own. Everything downstream is derived.
  const occLegs = holdings
    .map((h) => parseOccSymbol(h.ticker))
    .filter((p): p is NonNullable<typeof p> => p != null);
  const expiriesByUnderlying = new Map<string, Set<string>>();
  for (const p of occLegs) {
    const set = expiriesByUnderlying.get(p.underlying) ?? new Set<string>();
    set.add(p.expiry);
    expiriesByUnderlying.set(p.underlying, set);
  }
  const ivByOcc: Record<string, number> = {};
  const underlyingPrices: Record<string, number> = {};
  const chainByUnderlying: Record<string, OptionQuote[]> = {};
  if (expiriesByUnderlying.size > 0) {
    // CBOE is the primary source — free, no auth, and it ships real Greeks. Yahoo
    // now requires an auth crumb (401 headless), so it's only a best-effort
    // fallback for IV + underlying price if CBOE is unavailable for a symbol.
    const chains = await Promise.all(
      [...expiriesByUnderlying.entries()].map(async ([underlying, expiries]) => {
        const list = [...expiries];
        const chain =
          (await getCboeOptionChain(underlying, list)) ?? (await getOptionChain(underlying, list));
        return [underlying, chain] as const;
      }),
    );
    for (const [underlying, chain] of chains) {
      if (!chain) continue;
      Object.assign(ivByOcc, chain.ivByOcc);
      if (chain.underlyingPrice != null) underlyingPrices[underlying] = chain.underlyingPrice;
      if (chain.contracts.length) chainByUnderlying[underlying] = chain.contracts;
    }
  }

  // Ex-dividend calendar: pull Yahoo's upcoming ex-div/pay dates for the held
  // tickers, but only once we know some dividend income exists (the panel is
  // hidden otherwise, so the fetch would be wasted). Cached in the Data Cache.
  const dividendCalendar =
    dividendSummary.payments.length > 0 && symbols.length > 0
      ? await getDividendCalendar(symbols)
      : [];

  return (
    <div className="space-y-7">
      <PageHead
        title="Investments"
        action={
          <Link
            href="/investments/import"
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-sm text-[var(--paper)] transition hover:border-[var(--brass-dim)]"
          >
            <Upload size={15} /> Import trades
          </Link>
        }
      />
      <PortfolioView
        holdings={holdings}
        histories={histories}
        portfolioSeries={portfolioSeries}
        benchmarks={benchmarks}
        comparison={comparison}
        transactions={transactions}
        knownSectors={knownSectors}
        ivByOcc={ivByOcc}
        underlyingPrices={underlyingPrices}
        chainByUnderlying={chainByUnderlying}
        allocationTargets={allocationTargets}
        assetClassOverrides={assetClassOverrides}
        geographyOverrides={geographyOverrides}
        dividendSummary={dividendSummary}
        dividendCalendar={dividendCalendar}
      />
    </div>
  );
}
