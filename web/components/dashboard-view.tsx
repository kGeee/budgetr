"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  GripVertical,
  LayoutGrid,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardWidget, WIDGET_META } from "@/components/dashboard-widget";
import { WidgetPicker } from "@/components/widget-picker";
import {
  createDashboard,
  deleteDashboard,
  removeWidget,
  renameDashboard,
  reorderWidgets,
} from "@/lib/actions-dashboards";
import type { CategoryRow, WidgetData } from "@/lib/queries";
import type { Dashboard } from "@/db/schema";

export type ResolvedWidget = { id: string; data: WidgetData };

/**
 * The composable widget grid for a single dashboard. Read mode renders the
 * widgets responsively; edit mode adds a widget palette, per-widget remove, and
 * drag-to-reorder (persisted via reorderWidgets). Dashboard rename/delete live
 * in the header.
 */
export function DashboardView({
  dashboard,
  widgets,
  categories,
}: {
  dashboard: Dashboard;
  widgets: ResolvedWidget[];
  categories: CategoryRow[];
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
      <DashboardHeader
        dashboard={dashboard}
        edit={edit}
        onToggleEdit={() => setEdit((e) => !e)}
      />

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
                <DashboardWidget data={w.data} categories={categories} />
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
  dashboard,
  edit,
  onToggleEdit,
}: {
  dashboard: Dashboard;
  edit: boolean;
  onToggleEdit: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(dashboard.name);
  const [pending, start] = useTransition();

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === dashboard.name) {
      setName(dashboard.name);
      setRenaming(false);
      return;
    }
    start(async () => {
      await renameDashboard(dashboard.id, trimmed);
      setRenaming(false);
      router.refresh();
    });
  }

  function remove() {
    if (!confirm(`Delete "${dashboard.name}"? This can't be undone.`)) return;
    start(async () => {
      await deleteDashboard(dashboard.id);
      router.push("/dashboards");
    });
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        <p className="eyebrow">Dashboard</p>
        {renaming ? (
          <div className="mt-1.5 flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setName(dashboard.name);
                  setRenaming(false);
                }
              }}
              className="w-64 max-w-full rounded-lg border border-line bg-[var(--panel)] px-3 py-1.5 font-display text-2xl tracking-tight text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
            />
            <button
              onClick={saveName}
              disabled={pending}
              aria-label="Save name"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-[var(--jade)] hover:bg-[var(--panel)] disabled:opacity-50"
            >
              <Check size={16} />
            </button>
            <button
              onClick={() => {
                setName(dashboard.name);
                setRenaming(false);
              }}
              aria-label="Cancel rename"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-[var(--muted)] hover:bg-[var(--panel)]"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-2.5">
            <h1 className="truncate font-display text-3xl leading-none tracking-tight sm:text-4xl">
              {dashboard.name}
            </h1>
            <button
              onClick={() => setRenaming(true)}
              aria-label="Rename dashboard"
              className="text-[var(--faint)] transition-colors hover:text-[var(--paper)]"
            >
              <Pencil size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
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
        {edit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={pending}
            className="text-[var(--coral)] hover:bg-[color-mix(in_srgb,var(--coral)_12%,transparent)] hover:text-[var(--coral)]"
          >
            <Trash2 size={15} /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Standalone create-dashboard form for the index page. Creates the dashboard and
 * navigates straight into it so the user lands in the (empty) editor.
 */
export function CreateDashboardForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function create() {
    start(async () => {
      const id = await createDashboard(name || "Untitled dashboard");
      setName("");
      router.push(`/dashboards/${id}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()}
        placeholder="New dashboard name…"
        className="h-10 w-64 max-w-full rounded-full border border-line bg-[var(--panel)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[var(--faint)] focus:border-[var(--brass-dim)]"
      />
      <Button size="md" onClick={create} disabled={pending}>
        <Plus size={16} /> Create dashboard
      </Button>
    </div>
  );
}
