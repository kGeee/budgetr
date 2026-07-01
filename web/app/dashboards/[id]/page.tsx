import { notFound } from "next/navigation";
import { DashboardView, type ResolvedWidget } from "@/components/dashboard-view";
import { getCategories, getDashboardWithWidgets, getWidgetData } from "@/lib/queries";
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

export default async function DashboardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const found = getDashboardWithWidgets(id);
  if (!found) notFound();

  // Resolve each widget's data server-side so the client grid stays a pure,
  // serializable renderer.
  const widgets: ResolvedWidget[] = found.widgets.map((w) => ({
    id: w.id,
    data: getWidgetData(w.type, parseConfig(w.config)),
  }));

  // Categories back the daily-spend heatmap's day drill-down.
  const categories = getCategories();

  return (
    <DashboardView dashboard={found.dashboard} widgets={widgets} categories={categories} />
  );
}
