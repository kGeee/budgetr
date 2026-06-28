import { PageHead } from "@/components/page-head";
import { PortfolioView, type HoldingRow } from "@/components/portfolio-view";
import { getHoldings, getInvestmentTransactions, getManualHoldings } from "@/lib/queries";
import { buildReconstructedSeries, getTickerHistories } from "@/lib/portfolio-history";

export const dynamic = "force-dynamic";
// Holdings come from the DB (always fresh), but the Yahoo history fetches should
// hit the Data Cache instead of being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

export default async function InvestmentsPage() {
  const plaidHoldings = getHoldings();
  const transactions = getInvestmentTransactions();
  const manual = getManualHoldings();

  // Fetch price history for every tickered symbol — Plaid holdings + the
  // symbol-priced manual holdings (e.g. BTC-USD).
  const manualSymbols = manual
    .map((m) => m.symbol)
    .filter((s): s is string => Boolean(s));
  const symbols = [
    ...plaidHoldings.map((h) => h.ticker).filter((t): t is string => Boolean(t)),
    ...manualSymbols,
  ];
  const histories = await getTickerHistories(symbols);

  // Map manual holdings into the holdings shape. Tickered ones are valued by
  // quantity × price (live → Yahoo last close); fixed-value ones carry their
  // user-set value directly.
  const manualHoldings: HoldingRow[] = manual.map((m) => {
    const sym = m.symbol?.toUpperCase();
    const hist = sym ? histories[sym] : undefined;
    const lastClose = hist && hist.length > 0 ? hist[hist.length - 1].close : null;
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
      accountName: "Manual",
      manual: true,
    };
  });

  // Interleave manual holdings with Plaid ones, ordered by best-known value so
  // they sort in by size rather than always landing at the bottom. Live prices
  // refine the figure client-side but don't reorder (avoids jumpiness).
  const estValue = (h: HoldingRow): number =>
    h.value ?? (h.price ?? h.closePrice ?? 0) * (h.quantity ?? 0);
  const holdings = [...plaidHoldings, ...manualHoldings].sort(
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

  return (
    <div className="space-y-7">
      <PageHead title="Investments" />
      <PortfolioView
        holdings={holdings}
        histories={histories}
        portfolioSeries={portfolioSeries}
        transactions={transactions}
      />
    </div>
  );
}
