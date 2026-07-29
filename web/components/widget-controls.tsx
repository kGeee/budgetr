"use client";

/**
 * Per-widget range + order controls, rendered in the widget's header.
 *
 * These sit in read mode, not edit mode: changing "last 30 days" to "last year"
 * is exploring your data, not rearranging your dashboard, and burying it behind
 * an Edit toggle would make it a setting rather than a question you ask.
 *
 * The choice is persisted per widget (server action → dashboard_widgets.config),
 * so a board keeps the windows you chose. Updates are optimistic: the pill
 * flips immediately and the refreshed server data lands underneath it.
 */

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWidgetConfig } from "@/lib/actions-dashboards";
import type { WidgetConfig } from "@/lib/queries";

export type ControlOption = { label: string; value: number | string };

export type WidgetControlSpec = {
  /** Which config key this control writes. */
  key: keyof WidgetConfig;
  /** Short label for screen readers — the pills themselves are self-evident. */
  title: string;
  options: ControlOption[];
  fallback: number | string;
};

export function WidgetControls({
  widgetId,
  config,
  specs,
}: {
  widgetId: string;
  config: WidgetConfig;
  specs: WidgetControlSpec[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [optimistic, apply] = useOptimistic(
    config,
    (prev: WidgetConfig, patch: WidgetConfig) => ({ ...prev, ...patch }),
  );

  if (specs.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {specs.map((spec) => {
        const active = optimistic[spec.key] ?? spec.fallback;
        return (
          <div
            key={String(spec.key)}
            role="group"
            aria-label={spec.title}
            className="flex items-center rounded-full border border-line bg-[var(--ink)] p-0.5"
          >
            {spec.options.map((opt) => {
              const on = active === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  aria-pressed={on}
                  title={`${spec.title}: ${opt.label}`}
                  onClick={() => {
                    if (on) return;
                    const patch = { [spec.key]: opt.value } as WidgetConfig;
                    start(async () => {
                      apply(patch);
                      await updateWidgetConfig(widgetId, patch);
                      router.refresh();
                    });
                  }}
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] leading-4 transition-colors ${
                    on
                      ? "bg-[var(--panel-2)] text-[var(--paper)]"
                      : "text-[var(--muted)] hover:text-[var(--paper)]"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
