import { PageHead } from "@/components/page-head";
import { PortfolioView } from "@/components/portfolio-view";
import { getHoldings } from "@/lib/queries";
import { buildPortfolioSeries, getTickerHistories } from "@/lib/portfolio-history";

export const dynamic = "force-dynamic";
// Holdings come from the DB (always fresh), but the Stooq history fetches should
// hit the Data Cache instead of being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

export default async function InvestmentsPage() {
  const holdings = getHoldings();

  const symbols = holdings
    .map((h) => h.ticker)
    .filter((t): t is string => Boolean(t));
  const histories = await getTickerHistories(symbols);

  const positions = holdings
    .filter((h) => h.ticker && h.quantity)
    .map((h) => ({ ticker: h.ticker as string, quantity: h.quantity as number }));
  const portfolioSeries = buildPortfolioSeries(positions, histories);

  return (
    <div className="space-y-7">
      <PageHead title="Investments" />
      <PortfolioView
        holdings={holdings}
        histories={histories}
        portfolioSeries={portfolioSeries}
      />
    </div>
  );
}
