// Publishes the widget payload into the shared App Group and reloads the
// WidgetKit timelines. Keep the shape in sync with targets/widget/index.swift.
//
// We talk to the ExtensionStorage native module directly instead of going
// through @bacons/apple-targets' JS wrapper: that wrapper swaps in no-op stubs
// whenever the native module is missing (Expo Go, or a binary built before the
// widget target was linked), so every write silently succeeds while nothing
// reaches the App Group — the widget just keeps saying "Open the app to sync"
// with no way to tell why. Here the module is either present or it isn't, and
// every publish is verified by reading the value back.

import type { Summary } from "@budgetr/core";

const APP_GROUP = "group.dev.budgetr.companion";
const KEY = "widgetPayload";

/** What the last publish attempt did — surfaced in Settings so this is debuggable. */
export type WidgetStatus =
  | { state: "unknown" } // nothing published yet this launch
  | { state: "published"; at: number } // wrote and read it back; unix seconds
  | { state: "unavailable" } // no ExtensionStorage module — Expo Go, or needs a rebuild
  | { state: "failed"; detail: string };

// Expo registers native modules on the `expo` global; ExtensionStorage ships
// with @bacons/apple-targets and is linked at prebuild.
interface ExtensionStorageModule {
  setString(key: string, value: string, group?: string): void;
  get(key: string, group?: string): string | null;
  reloadWidget(name?: string): void;
}

function nativeStorage(): ExtensionStorageModule | null {
  const g = globalThis as unknown as { expo?: { modules?: Record<string, unknown> } };
  const mod = g.expo?.modules?.ExtensionStorage as ExtensionStorageModule | undefined;
  return mod && typeof mod.setString === "function" && typeof mod.get === "function" ? mod : null;
}

export function publishWidgetData(summary: Summary): WidgetStatus {
  const storage = nativeStorage();
  if (!storage) return { state: "unavailable" };

  try {
    const payload = {
      asOf: summary.asOf,
      netWorthCents: summary.netWorth.cents,
      spark: summary.netWorth.spark.slice(-30).map((p) => p.cents),
      spentCents: summary.budgets.reduce((a, b) => a + b.spentCents, 0),
      budgetCents: summary.budgets.reduce((a, b) => a + b.limitCents, 0),
      ...budgetPace(summary),
    };
    const json = JSON.stringify(payload);
    storage.setString(KEY, json, APP_GROUP);

    // Read it back: if the App Group isn't actually shared (entitlement or
    // provisioning profile missing the group) writes go nowhere, and this is
    // the only signal we get on the app side.
    if (!storage.get(KEY, APP_GROUP)) {
      return { state: "failed", detail: "App Group write did not land" };
    }

    storage.reloadWidget();
    return { state: "published", at: Math.floor(Date.now() / 1000) };
  } catch (err) {
    // Never let widget publishing break sync.
    return { state: "failed", detail: err instanceof Error ? err.message : "publish failed" };
  }
}

// Cumulative month-to-date spend by day-of-month — the same series the app's
// Budgets pace chart draws (budgets.tsx). Precomputed here so the Swift widget
// only has to plot it, not redo the month/day math.
function budgetPace(summary: Summary): { budgetCum: number[]; daysInMonth: number; dayOfMonth: number } {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = Math.min(now.getDate(), daysInMonth);
  const monthStart = Date.UTC(now.getFullYear(), now.getMonth(), 1) / 1000;

  const byDay = new Map<number, number>();
  for (const p of summary.spendByDay ?? []) {
    if (p.d < monthStart) continue;
    const dom = new Date(p.d * 1000).getUTCDate();
    byDay.set(dom, (byDay.get(dom) ?? 0) + p.cents);
  }

  const budgetCum: number[] = [];
  let run = 0;
  for (let d = 1; d <= dayOfMonth; d++) {
    run += byDay.get(d) ?? 0;
    budgetCum.push(run);
  }
  return { budgetCum, daysInMonth, dayOfMonth };
}
