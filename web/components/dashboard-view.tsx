"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GripVertical, LayoutGrid, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHead } from "@/components/page-head";
import { DashboardWidget, WIDGET_META } from "@/components/dashboard-widget";
import { WidgetPicker } from "@/components/widget-picker";
import { addWidget, removeWidget, reorderWidgets } from "@/lib/actions-dashboards";
import { OVERVIEW_DEFAULT_WIDGETS, WIDGET_SLOT, layoutBands } from "@/lib/home-layout";
import type { CategoryRow, WidgetConfig, WidgetData } from "@/lib/queries";
import type { Dashboard } from "@/db/schema";

export type ResolvedWidget = { id: string; data: WidgetData; config?: WidgetConfig };

/**
 * Home's composable widget board — the one remaining dashboard (the reserved
 * Overview board). The stored order is folded into bands: a full-width widget
 * (the net-worth hero, a year heatmap) spans the page, and everything between
 * two of those shares a wide column and a narrow one. Edit mode adds a widget
 * palette, per-widget remove, drag-to-reorder (persisted via reorderWidgets)
 * and a reset to the stock board.
 *
 * Two fixed pieces are woven in: `strip` sits under the opening hero, and
 * `lead` heads the first wide column, so what needs attention is read before
 * the ledger beneath it.
 */
export function DashboardView({
  dashboard,
  widgets,
  categories,
  lead,
  strip,
}: {
  dashboard: Dashboard;
  widgets: ResolvedWidget[];
  categories: CategoryRow[];
  lead?: React.ReactNode;
  strip?: React.ReactNode;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [pending, start] = useTransition();
  const [confirmReset, setConfirmReset] = useState(false);

  // Local order for optimistic drag reordering; server state is the source of
  // truth after the action + refresh land. Ids the server no longer has are
  // dropped and new ones appended, so an add or a reset shows without a reload.
  const [order, setOrder] = useState<string[]>(widgets.map((w) => w.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(widgets.map((w) => [w.id, w]));
  // Removed here but not yet gone from the server's list — kept out of the
  // "new ones" tail so a removed widget doesn't flash back before the refresh.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const known = new Set(order);
  const ordered = [
    ...order.map((id) => byId.get(id)).filter((w): w is ResolvedWidget => Boolean(w)),
    ...widgets.filter((w) => !known.has(w.id)),
  ].filter((w) => !removed.has(w.id));
  const ids = ordered.map((w) => w.id);

  function persistOrder(next: string[]) {
    setOrder(next);
    start(async () => {
      await reorderWidgets(dashboard.id, next);
      router.refresh();
    });
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...ids];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    setDragId(null);
    persistOrder(next);
  }

  function remove(id: string) {
    setOrder(ids.filter((x) => x !== id));
    setRemoved((prev) => new Set(prev).add(id));
    start(async () => {
      await removeWidget(id);
      router.refresh();
    });
  }

  /** Back to the stock board: clear what's here, then add the defaults in order. */
  function reset() {
    setConfirmReset(false);
    start(async () => {
      setRemoved(new Set(ids));
      for (const id of ids) await removeWidget(id);
      for (const w of OVERVIEW_DEFAULT_WIDGETS) {
        await addWidget(dashboard.id, w.type, w.config ?? {});
      }
      setOrder([]);
      router.refresh();
    });
  }

  const bands = layoutBands(ordered, (w) => WIDGET_SLOT[w.data.type]);
  const firstColumns = bands.findIndex((b) => b.kind === "columns");
  // The strip belongs under the hero; a board that doesn't open on one gets it
  // first instead.
  const stripAfterFirst = bands[0]?.kind === "full";

  const cell = (w: ResolvedWidget) => (
    <div
      key={w.id}
      className={`relative ${edit ? "cursor-move rounded-xl outline-1 outline-offset-8 outline-dashed outline-line" : ""} ${
        dragId === w.id ? "opacity-40" : ""
      }`}
      draggable={edit}
      onDragStart={() => edit && setDragId(w.id)}
      onDragEnd={() => setDragId(null)}
      onDragOver={(e) => edit && e.preventDefault()}
      onDrop={() => edit && onDrop(w.id)}
    >
      {edit && (
        <div className="absolute -top-3 right-0 z-10 flex items-center gap-1.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--muted)]">
            <GripVertical size={14} />
          </span>
          <button
            type="button"
            onClick={() => remove(w.id)}
            disabled={pending}
            aria-label={`Remove ${WIDGET_META[w.data.type].label}`}
            className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--muted)] transition-colors hover:border-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      <DashboardWidget id={w.id} config={w.config} data={w.data} categories={categories} />
    </div>
  );

  return (
    <div className="space-y-9">
      <DashboardHeader edit={edit} onToggleEdit={() => setEdit((e) => !e)} />

      {!stripAfterFirst && strip}
      {/* With no columns to head, "Needs you" still comes before any figure. */}
      {firstColumns === -1 && !stripAfterFirst && lead}

      {ordered.length === 0 && !edit && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center border-y border-dashed border-line text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--brass-dim)] text-[var(--brass)]">
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

      {bands.map((band, i) => {
        if (band.kind === "full") {
          return (
            <Fragment key={band.item.id}>
              {cell(band.item)}
              {i === 0 && strip}
              {i === 0 && firstColumns === -1 && lead}
            </Fragment>
          );
        }
        const withLead = i === firstColumns && lead;
        const hasMain = band.main.length > 0 || Boolean(withLead);
        const hasSide = band.side.length > 0;
        return (
          <div
            key={`columns-${band.main[0]?.id ?? band.side[0]?.id}`}
            className={`grid gap-x-12 gap-y-9 ${
              hasMain && hasSide ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""
            }`}
          >
            {hasMain && (
              <div className="flex min-w-0 flex-col gap-9">
                {withLead}
                {band.main.map(cell)}
              </div>
            )}
            {hasSide && <div className="flex min-w-0 flex-col gap-9">{band.side.map(cell)}</div>}
          </div>
        );
      })}

      {edit && (
        <>
          <WidgetPicker dashboardId={dashboard.id} onAdded={() => router.refresh()} />
          <div className="flex flex-wrap items-center justify-end gap-3 text-[13px] text-[var(--muted)]">
            {confirmReset ? (
              <>
                <span>Replace this board with the stock layout?</span>
                <Button size="sm" variant="secondary" onClick={reset} disabled={pending}>
                  Reset
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmReset(true)}
                disabled={pending}
              >
                <RotateCcw size={14} /> Reset to the stock layout
              </Button>
            )}
          </div>
        </>
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
