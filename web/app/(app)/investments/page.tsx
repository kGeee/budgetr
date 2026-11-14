import Link from "next/link";
import { Upload } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { parseInvestmentsTab } from "@/components/investments-tab-keys";
import { isTradingDeskEnabled } from "@/lib/trading-desk";
import { HoldingsTab } from "./_tabs/holdings-tab";
import { AllocationTab } from "./_tabs/allocation-tab";
import { IncomeTab } from "./_tabs/income-tab";

export const dynamic = "force-dynamic";
// Holdings come from the DB (always fresh), but the Yahoo history fetches should
// hit the Data Cache instead of being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

/**
 * Investments, in three tabs (`?tab=`): Holdings (default), Allocation, and
 * Income & gains. Each tab loads only its own data — the value history and
 * benchmarks, the risk analysis, the dividend calendar and tax lots used to be
 * one long page (plus /investments/analysis and /realized-gains), and every
 * visit paid for all of them. The tab bar itself is in investments/layout.tsx.
 */
export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = parseInvestmentsTab((await searchParams).tab);

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
      {tab === "allocation" ? (
        <AllocationTab />
      ) : tab === "income" ? (
        <IncomeTab />
      ) : (
        <HoldingsTab tradingDesk={isTradingDeskEnabled()} />
      )}
    </div>
  );
}
