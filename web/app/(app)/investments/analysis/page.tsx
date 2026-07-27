import { PageHead } from "@/components/page-head";
import { AnalysisView } from "@/components/analysis-view";
import { buildAnalysisData } from "@/lib/analysis-data";

// Holdings stay fresh from the DB; Yahoo OHLCV + Finnhub fundamentals ride the
// Data Cache (6h / 24h), so re-opening the desk is cheap.
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

export default async function AnalysisPage() {
  const data = await buildAnalysisData();
  return (
    <div className="space-y-7">
      {/* The shared Investments tab bar (rendered by investments/layout.tsx)
          replaces the old "← Investments" back-link. */}
      <PageHead title="Analysis desk" />
      <AnalysisView data={data} />
    </div>
  );
}
