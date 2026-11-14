import { Suspense } from "react";
import { AllocationView } from "@/components/portfolio/allocation-view";
import { AnalysisView } from "@/components/analysis-view";
import { Card } from "@/components/ui/card";
import { buildAnalysisData } from "@/lib/analysis-data";
import {
  getAllocationTargets,
  getAssetClassOverrides,
  getGeographyOverrides,
  getKnownSectors,
} from "@/lib/queries";
import { loadHoldings } from "./holdings-data";

/**
 * Investments › Allocation: what the book is made of (asset class, geography,
 * sector, targets) and how risky that makes it (beta, concentration,
 * correlation, per-holding technicals — the old /investments/analysis desk).
 */
export async function AllocationTab() {
  const { holdings } = await loadHoldings();
  return (
    <div className="space-y-7">
      <AllocationView
        holdings={holdings}
        knownSectors={getKnownSectors()}
        allocationTargets={getAllocationTargets()}
        assetClassOverrides={getAssetClassOverrides()}
        geographyOverrides={getGeographyOverrides()}
      />
      {/* The risk analysis pulls a year of bars per holding plus fundamentals,
          so it streams in under the allocation rather than holding it up. */}
      <section className="space-y-4">
        <span className="eyebrow">Risk &amp; technicals</span>
        <Suspense
          fallback={
            <Card className="p-10 text-center text-sm text-[var(--muted)]">
              Crunching a year of prices for each holding…
            </Card>
          }
        >
          <RiskAnalysis />
        </Suspense>
      </section>
    </div>
  );
}

async function RiskAnalysis() {
  const data = await buildAnalysisData();
  return <AnalysisView data={data} />;
}
