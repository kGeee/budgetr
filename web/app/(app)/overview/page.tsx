import { PlaidLink } from "@/components/plaid-link";
import { DashboardView, type ResolvedWidget } from "@/components/dashboard-view";
import { ensureFirstRunDemo } from "@/lib/demo-data";
import {
  ensureOverviewDashboard,
  getCategories,
  getItems,
  getWidgetData,
} from "@/lib/queries";
import type { WidgetConfig } from "@/lib/queries";

export const dynamic = "force-dynamic";

function parseConfig(raw: string | null): WidgetConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as WidgetConfig;
  } catch {
    return {};
  }
}

/**
 * The Overview landing screen is now a customizable dashboard: it renders the
 * reserved "Overview" board (seeded on first run with the net-worth hero,
 * spending review, review queue, cashflow, budgets, activity and bills) through
 * the same editable/draggable widget grid as any custom dashboard. Users can add,
 * remove and reorder widgets here to shape what — and how — they see on landing.
 */
export default async function Overview() {
  let items = getItems();

  // Brand-new install → load the bundled demo data so the first screen is fully
  // populated. Once the user exits demo mode with nothing linked, fall through to
  // the empty state below.
  if (items.length === 0 && ensureFirstRunDemo()) items = getItems();
  if (items.length === 0) return <EmptyState />;

  const { dashboard, widgets } = ensureOverviewDashboard();

  // Resolve each widget's data server-side so the client grid stays a pure,
  // serializable renderer (same contract as /dashboards/[id]).
  const resolved: ResolvedWidget[] = widgets.map((w) => ({
    id: w.id,
    data: getWidgetData(w.type, parseConfig(w.config)),
  }));

  // Categories back the review inbox drawer + daily-spend heatmap drill-down.
  const categories = getCategories();

  return (
    <DashboardView dashboard={dashboard} widgets={resolved} categories={categories} overview />
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--brass-dim)] bg-[var(--panel)] font-display text-2xl text-[var(--brass)]">
        ₿
      </span>
      <h1 className="mt-6 font-display text-4xl tracking-tight">Open your ledger</h1>
      <p className="mt-3 text-[var(--muted)]">
        Connect your card, brokerage, and bank to track net worth, spending, and income — all
        read-only and stored on this machine. In Plaid Sandbox, search any bank and log in with{" "}
        <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[var(--paper)]">
          user_good
        </code>{" "}
        /{" "}
        <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[var(--paper)]">
          pass_good
        </code>
        .
      </p>
      <div className="mt-8">
        <PlaidLink />
      </div>
    </div>
  );
}
