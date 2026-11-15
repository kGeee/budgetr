import { cache, Suspense } from "react";
import { AllocationView } from "@/components/portfolio/allocation-view";
import { RiskReturn, RiskSignals } from "@/components/analysis-view";
import { buildAnalysisData } from "@/lib/analysis-data";
import {
  getAllocationTargets,
  getAssetClassOverrides,
  getGeographyOverrides,
  getKnownSectors,
} from "@/lib/queries";
import { loadHoldings } from "./holdings-data";

/**
 * The risk analysis pulls a year of bars per holding plus fundamentals. Three
 * places on the tab read it (β in the hero line, the scatter, the signals), so
 * it is built once per request and each reader streams in when it lands.
 */
const loadAnalysis = cache(buildAnalysisData);

/**
 * Investments › Allocation: how concentrated the book is, what it is made of
 * (sector, asset class, geography, targets) and how risky that makes it (beta,
 * risk vs. return, per-holding signals, correlation — the old
 * /investments/analysis desk).
 */
export async function AllocationTab() {
  const { holdings } = await loadHoldings();
  return (
    <div className="space-y-9">
      <AllocationView
        holdings={holdings}
        knownSectors={getKnownSectors()}
        allocationTargets={getAllocationTargets()}
        assetClassOverrides={getAssetClassOverrides()}
        geographyOverrides={getGeographyOverrides()}
        beta={
          <Suspense fallback={<span className="text-[var(--muted)]">…</span>}>
            <PortfolioBeta />
          </Suspense>
        }
        riskReturn={
          <Suspense fallback={<Crunching />}>
            <RiskReturnSection />
          </Suspense>
        }
      />
      <Suspense fallback={<Crunching />}>
        <SignalsSection />
      </Suspense>
    </div>
  );
}

function Crunching() {
  return (
    <p className="border-t border-[var(--line-strong)] pt-4 text-sm text-[var(--muted)]">
      Crunching a year of prices for each holding…
    </p>
  );
}

async function PortfolioBeta() {
  const { portfolio } = await loadAnalysis();
  if (portfolio.beta == null) return <span className="text-[var(--muted)]">—</span>;
  // Past 1.2 the book swings noticeably harder than the index it is measured on.
  return (
    <span className={portfolio.beta > 1.2 ? "text-[var(--coral)]" : undefined}>
      {portfolio.beta.toFixed(2)} vs SPY
    </span>
  );
}

async function RiskReturnSection() {
  return <RiskReturn data={await loadAnalysis()} />;
}

async function SignalsSection() {
  return <RiskSignals data={await loadAnalysis()} />;
}
