import { BrandMark } from "@/components/brand-mark";
import { PlaidLink } from "@/components/onboarding/plaid-link";
import { AlertsPanel } from "@/components/alerts-panel";
import { DashboardView, type ResolvedWidget } from "@/components/dashboard-view";
import { DataFreshnessBanner } from "@/components/data-freshness";
import { ThisMonthStrip } from "@/components/home-strip";
import { detectAnomalies } from "@/lib/anomalies";
import { getDataFreshness } from "@/lib/data-freshness";
import { getDataHealthAlerts } from "@/lib/data-health";
import { ensureFirstRunDemo } from "@/lib/demo-data";
import { monthPace, portfolioTotals, presentOrder } from "@/lib/home-layout";
import {
  countUnreviewed,
  ensureOverviewDashboard,
  getCategories,
  getHoldings,
  getItems,
  getMonthlyBudgetSummary,
  getTransactionsToReview,
  getUpcomingBills,
  getWidgetData,
} from "@/lib/queries";
import type { WidgetConfig } from "@/lib/queries";
import { loadInclusiveNetWorth } from "@/lib/net-worth";

export const dynamic = "force-dynamic";
// Net worth prices manual holdings from Yahoo histories; let those hit the Data
// Cache rather than being forced no-store by `force-dynamic` (as Investments does).
export const fetchCache = "default-cache";

function parseConfig(raw: string | null): WidgetConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as WidgetConfig;
  } catch {
    return {};
  }
}

/** How many review rows Home lists before pointing at the full inbox. */
const REVIEW_PREVIEW = 3;

/**
 * Home: the reserved Overview board's widgets — add, remove and reorder them to
 * shape the landing page — with two fixed pieces woven in: the "this month"
 * rule under the hero, and "Needs you" (data health, spending alerts, the first
 * of the review backlog) at the head of the wide column.
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
  // serializable renderer.
  // Net worth includes manual and imported holdings, which need prices — load
  // them once only if a net-worth widget is on the board. A price-feed failure
  // falls back to the account-only figure rather than failing the page.
  const needsNetWorth = widgets.some((w) => w.type === "net-worth" || w.type === "net-worth-summary");
  const inclusive = needsNetWorth ? await loadInclusiveNetWorth().catch(() => undefined) : undefined;
  const resolved: ResolvedWidget[] = presentOrder(widgets).map((w) => ({
    id: w.id,
    config: parseConfig(w.config),
    data: getWidgetData(w.type, parseConfig(w.config), inclusive),
  }));

  // Categories back the review inbox drawer + daily-spend heatmap drill-down.
  const categories = getCategories();

  // Landing screen: a dead connection or a ledger that stopped moving is the one
  // thing that should interrupt before any figure below it is read.
  const freshness = getDataFreshness();

  // Health first, always — a clear spending board only reassures if the data
  // behind it is complete. The review-backlog health alert is dropped here
  // because the card's own review line already says it, with a live count.
  const alerts = [
    ...getDataHealthAlerts().filter((a) => a.key !== "health:review-backlog"),
    ...detectAnomalies(),
  ];
  const reviewCount = countUnreviewed();
  const review = reviewCount > 0 ? getTransactionsToReview(REVIEW_PREVIEW) : [];

  // The "this month" rule, from the same queries the pages it links to use.
  const budget = getMonthlyBudgetSummary();
  const nextBill = getUpcomingBills(31)[0] ?? null;

  return (
    <>
      <DataFreshnessBanner freshness={freshness} className="mb-6" />
      <DashboardView
        dashboard={dashboard}
        widgets={resolved}
        categories={categories}
        strip={
          <ThisMonthStrip
            budget={budget}
            pace={monthPace(budget.month, new Date())}
            portfolio={portfolioTotals(getHoldings())}
            nextBill={nextBill}
          />
        }
        lead={
          <AlertsPanel
            alerts={alerts}
            reviewCount={reviewCount}
            review={review}
            categories={categories}
            limit={3}
            compact
          />
        }
      />
    </>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center text-center">
      <BrandMark size={56} />
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
