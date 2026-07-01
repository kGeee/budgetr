import Link from "next/link";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { Card } from "@/components/ui/card";
import { CreateDashboardForm } from "@/components/dashboard-view";
import { getDashboards } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardsPage() {
  const dashboards = getDashboards();

  return (
    <div className="space-y-7">
      <PageHead title="Dashboards" action={<CreateDashboardForm />} />

      {dashboards.length === 0 ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-[var(--radius)] border border-dashed border-line text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--brass-dim)] bg-[var(--panel)] text-[var(--brass)]">
            <LayoutGrid size={24} />
          </span>
          <h2 className="mt-6 font-display text-3xl tracking-tight">Compose your own view</h2>
          <p className="mt-3 max-w-md text-sm text-[var(--muted)]">
            Dashboards let you pin the charts you care about — net worth, cashflow,
            spending, budgets — into one grid. Name one above to begin.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((d) => (
            <Link key={d.id} href={`/dashboards/${d.id}`}>
              <Card interactive className="h-full">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-line text-[var(--brass)]">
                    <LayoutGrid size={18} />
                  </span>
                  <ArrowUpRight size={16} className="text-[var(--faint)]" />
                </div>
                <p className="mt-4 truncate font-display text-xl tracking-tight text-[var(--paper)]">
                  {d.name}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {d.widgetCount} {d.widgetCount === 1 ? "widget" : "widgets"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
