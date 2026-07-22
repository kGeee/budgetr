import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
      <PageHead
        title="Analysis desk"
        action={
          <Link
            href="/investments"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
          >
            <ArrowLeft size={15} />
            Investments
          </Link>
        }
      />
      <AnalysisView data={data} />
    </div>
  );
}
