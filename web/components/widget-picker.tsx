"use client";

import { useTransition } from "react";
import { Plus } from "lucide-react";
import { SectionHead } from "@/components/ui/statement";
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
    <section aria-label="Add a widget">
      <SectionHead title="Add a widget" />
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        {WIDGET_TYPES.map((type) => {
          const meta = WIDGET_META[type];
          const Icon = meta.icon;
          return (
            <button
              key={type}
              type="button"
              disabled={pending}
              onClick={() => add(type)}
              className="group flex min-h-[60px] items-center gap-3 border-b border-line py-3 text-left transition-colors hover:border-[var(--brass-dim)] disabled:opacity-50"
            >
              <Icon size={16} className="shrink-0 text-[var(--brass)]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--paper)]">
                  {meta.label}
                  <Plus
                    size={13}
                    className="text-[var(--muted)] transition-colors group-hover:text-[var(--jade)]"
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
    </section>
  );
}
