import { PageHead } from "@/components/page-head";
import { FireDashboard } from "@/components/fire-dashboard";
import { getFireMetrics, getFireProjectionSeries } from "@/lib/fire";

export const dynamic = "force-dynamic";

export default function FirePage() {
  const metrics = getFireMetrics();
  const projection = getFireProjectionSeries();

  return (
    <div className="space-y-7">
      <PageHead title="FIRE" />
      <FireDashboard metrics={metrics} projection={projection} />
    </div>
  );
}
