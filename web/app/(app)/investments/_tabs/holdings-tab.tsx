import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { getInvestmentTransactions, getKnownSectors } from "@/lib/queries";
import {
  buildReconstructedSeriesWithFlows,
  downsampleHistories,
  downsampleSeries,
  getTickerHistories,
  type PricePoint,
} from "@/lib/portfolio-history";
import { computeComparison, twrIndexSeries, type BenchmarkKey } from "@/lib/benchmark";
import { loadHoldings } from "./holdings-data";

/**
 * Investments › Holdings: value history against the benchmarks, then the
 * holdings. The only tab that needs the trade ledger and SPY/QQQ, so those are
 * loaded here and nowhere else.
 */
export async function HoldingsTab({ tradingDesk }: { tradingDesk: boolean }) {
  const { holdings, histories, fixedValueTotal } = await loadHoldings();
  const transactions = getInvestmentTransactions();
  const knownSectors = getKnownSectors();

  // Reconstruct the value curve from the actual buy/sell ledger (anchored to
  // today's holdings) so older days reflect what was really held back then.
  // Manual tickered holdings have no trade ledger, so they ride at constant
  // quantity across the window.
  const trades = transactions
    .filter((t) => t.quantity != null && t.quantity !== 0)
    .map((t) => ({ ticker: t.ticker, date: t.date, quantity: t.quantity }));
  // Reconstructed series carries each day's external cash flow (buys/sells) too,
  // which the time-weighted return below needs. The plain value line ignores it.
  const reconstructed = buildReconstructedSeriesWithFlows(holdings, trades, histories);
  const rawSeries = reconstructed.map((p) => ({ date: p.date, value: p.value }));

  // Fold fixed-value manual assets (no symbol) into the chart as a constant so
  // the portfolio line matches the headline Market value. Tickered manual
  // holdings are already in the series via `holdings`.
  const portfolioSeries =
    fixedValueTotal > 0
      ? rawSeries.map((p) => ({ date: p.date, value: p.value + fixedValueTotal }))
      : rawSeries;

  // Time-weighted return index (base 100) for the benchmark comparison. TWR
  // removes the effect of deposits/withdrawals so the portfolio's return is
  // measured purely on price appreciation — apples-to-apples with SPY/QQQ, which
  // carry no cash flows. Basing this on `reconstructed` (the tickered series +
  // its dated buy/sell flows) deliberately EXCLUDES the constant fixed-value
  // block: with no dated flow and a flat value, folding it in would only drag
  // every daily return toward zero without representing any real performance.
  const portfolioReturnSeries = twrIndexSeries(reconstructed);

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
  // Compare the deposit-adjusted (time-weighted) portfolio return against the
  // benchmarks, not the raw market-value line — otherwise a day's deposit would
  // read as outperformance.
  const comparison = computeComparison(portfolioReturnSeries, benchmarks);

  // No option chains are fetched here. The desk that needs them lives at
  // /investments/options; this tab shows a three-number summary and links to it.
  // Dropping the fetch removed three multi-megabyte requests per render — MU's
  // chain alone is 7.3 MB, over Next's 2 MB data-cache ceiling.

  return (
    <PortfolioView
      holdings={holdings}
      // Raw daily history above powers valuation, the reconstructed value
      // curve and the TWR index; only the display copy crosses to the client.
      histories={downsampleHistories(histories)}
      portfolioSeries={portfolioSeries}
      portfolioReturnSeries={portfolioReturnSeries}
      benchmarks={{
        SPY: benchmarks.SPY && downsampleSeries(benchmarks.SPY),
        QQQ: benchmarks.QQQ && downsampleSeries(benchmarks.QQQ),
      }}
      comparison={comparison}
      transactions={transactions}
      knownSectors={knownSectors}
      tradingDesk={tradingDesk}
    />
  );
}
