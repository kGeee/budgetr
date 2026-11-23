import { FireDashboard } from "@/components/fire-dashboard";
import { getFireMetrics, getFireProjectionSeries } from "@/lib/fire";
import { loadInclusiveNetWorth } from "@/lib/net-worth";

/** "Long run" tab of /plan — the FIRE dashboard that used to be /fire. */
export async function LongRunTab() {
  // Net worth includes manual and imported holdings; on a price-feed failure,
  // fall back to the account-only figure rather than failing the tab.
  const inclusive = await loadInclusiveNetWorth().catch(() => undefined);
  return (
    <FireDashboard
      metrics={getFireMetrics(inclusive)}
      projection={getFireProjectionSeries(40, inclusive)}
    />
  );
}
