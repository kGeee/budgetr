import { PageHead } from "@/components/page-head";
import { BillsTab } from "./bills-tab";
import { ForecastTab } from "./forecast-tab";
import { LongRunTab } from "./long-run-tab";
import { PlanTabs, isPlanTab } from "./plan-tabs";

export const dynamic = "force-dynamic";

/**
 * "What's coming?" — the month's cash forecast, the recurring bills & income,
 * and the long-run FIRE view, which used to be three pages (/cashflow,
 * /recurring, /fire). Only the active tab's data is loaded.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab = isPlanTab(tabParam) ? tabParam : "forecast";

  return (
    <div className="space-y-7">
      <PageHead title="What's coming?" />
      <div className="-mt-2">
        <PlanTabs active={tab} />
      </div>
      {tab === "bills" ? <BillsTab /> : tab === "long-run" ? <LongRunTab /> : <ForecastTab />}
    </div>
  );
}
