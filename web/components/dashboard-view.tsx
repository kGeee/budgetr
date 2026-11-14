"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GripVertical, LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHead } from "@/components/page-head";
import { DashboardWidget, WIDGET_META } from "@/components/dashboard-widget";
import { WidgetPicker } from "@/components/widget-picker";
import { removeWidget, reorderWidgets } from "@/lib/actions-dashboards";
import type { CategoryRow, WidgetConfig, WidgetData } from "@/lib/queries";
import type { Dashboard } from "@/db/schema";

export type ResolvedWidget = { id: string; data: WidgetData; config?: WidgetConfig };

/**
 * Home's composable widget grid — the one remaining dashboard (the reserved
 * Overview board). Read mode renders the widgets responsively; edit mode adds a
 * widget palette, per-widget remove, and drag-to-reorder (persisted via
 * reorderWidgets). `lead` renders between the title and the grid, so what needs
 * attention is read before any figure.
 */
export function DashboardView({
  dashboard,
  widgets,
  categories,
  lead,
}: {
  dashboard: Dashboard;
  widgets: ResolvedWidget[];
  categories: CategoryRow[];
  lead?: React.ReactNode;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [pending, start] = useTransition();

  // Local order for optimistic drag reordering; server state is the source of
  // truth after the action + refresh land.
  const [order, setOrder] = useState<string[]>(widgets.map((w) => w.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const ordered = order.map((id) => byId.get(id)).filter((w): w is ResolvedWidget => Boolean(w));

  function persistOrder(next: string[]) {
    setOrder(next);
    start(async () => {
      await reorderWidgets(dashboard.id, next);
      router.refresh();
    });
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...order];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    setDragId(null);
    persistOrder(next);
  }

  function remove(id: string) {
    setOrder((o) => o.filter((x) => x !== id));
    start(async () => {
      await removeWidget(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-7">
      <DashboardHeader edit={edit} onToggleEdit={() => setEdit((e) => !e)} />

      {lead}

      {ordered.length === 0 && !edit && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-[var(--radius)] border border-dashed border-line text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--brass-dim)] bg-[var(--panel)] text-[var(--brass)]">
            <LayoutGrid size={22} />
          </span>
          <p className="mt-5 font-display text-2xl tracking-tight">An empty canvas</p>
          <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
            Add net-worth, cashflow, spending and budget widgets to compose a view
            that&apos;s all yours.
          </p>
          <Button className="mt-6" onClick={() => setEdit(true)}>
            <Plus size={16} /> Add widgets
          </Button>
        </div>
      )}

      {ordered.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {ordered.map((w) => {
            const wide = WIDGET_META[w.data.type].wide;
            return (
              <div
                key={w.id}
                className={`relative ${wide ? "lg:col-span-2" : ""} ${
                  edit ? "cursor-move" : ""
                } ${dragId === w.id ? "opacity-40" : ""}`}
                draggable={edit}
                onDragStart={() => edit && setDragId(w.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => edit && e.preventDefault()}
                onDrop={() => edit && onDrop(w.id)}
              >
                {edit && (
                  <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
                    <span className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--muted)]">
                      <GripVertical size={14} />
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(w.id)}
                      disabled={pending}
                      aria-label="Remove widget"
                      className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--muted)] transition-colors hover:border-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
                <DashboardWidget id={w.id} config={w.config} data={w.data} categories={categories} />
              </div>
            );
          })}
        </div>
      )}

      {edit && (
        <WidgetPicker dashboardId={dashboard.id} onAdded={() => router.refresh()} />
      )}
    </div>
  );
}

function DashboardHeader({
  edit,
  onToggleEdit,
}: {
  edit: boolean;
  onToggleEdit: () => void;
}) {
  return (
    <PageHead
      title="Home"
      action={
        <Button variant={edit ? "primary" : "secondary"} size="sm" onClick={onToggleEdit}>
          {edit ? (
            <>
              <Check size={15} /> Done
            </>
          ) : (
            <>
              <Pencil size={15} /> Edit
            </>
          )}
        </Button>
      }
    />
  );
}
