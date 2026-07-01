"use client";

import { useTransition } from "react";
import { Plus } from "lucide-react";
import { WIDGET_META, WIDGET_TYPES } from "@/components/dashboard-widget";
import { addWidget } from "@/lib/actions-dashboards";
import type { WidgetType } from "@/lib/queries";

/**
 * The "add a widget" palette shown in edit mode. Each tile appends a widget of
 * that type (with its default config) to the dashboard, then the parent grid
 * refreshes to render it.
 */
export function WidgetPicker({
  dashboardId,
  onAdded,
}: {
  dashboardId: string;
  onAdded?: () => void;
}) {
  const [pending, start] = useTransition();

  function add(type: WidgetType) {
    start(async () => {
      await addWidget(dashboardId, type, WIDGET_META[type].defaultConfig);
      onAdded?.();
    });
  }

  return (
    <div className="rounded-[var(--radius)] border border-dashed border-line bg-[var(--panel)] p-5">
      <p className="eyebrow mb-4">Add a widget</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WIDGET_TYPES.map((type) => {
          const meta = WIDGET_META[type];
          const Icon = meta.icon;
          return (
            <button
              key={type}
              type="button"
              disabled={pending}
              onClick={() => add(type)}
              className="group flex items-start gap-3 rounded-xl border border-line bg-[var(--panel-2)] p-4 text-left transition-colors hover:border-[var(--brass-dim)] hover:bg-[var(--panel)] disabled:opacity-50"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-[var(--brass)] transition-colors group-hover:border-[var(--brass-dim)]">
                <Icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--paper)]">
                  {meta.label}
                  <Plus
                    size={13}
                    className="text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted)]">
                  {meta.blurb}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
