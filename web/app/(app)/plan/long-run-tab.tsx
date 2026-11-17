import { FireDashboard } from "@/components/fire-dashboard";
import { getFireMetrics, getFireProjectionSeries } from "@/lib/fire";

/** "Long run" tab of /plan — the FIRE dashboard that used to be /fire. */
export function LongRunTab() {
  return <FireDashboard metrics={getFireMetrics()} projection={getFireProjectionSeries()} />;
}
