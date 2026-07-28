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

import Constants, { ExecutionEnvironment } from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";

import type { Summary } from "@budgetr/core";
import { categorySpend, monthTotals, monthWindow, type MonthWindow } from "@/spending";

const APP_GROUP = "group.dev.budgetr.companion";
const KEY = "widgetPayload";
const MAX_WIDGET_CATEGORIES = 6; // what the systemLarge legend can show without scrolling

/** What the last publish attempt did — surfaced in Settings so this is debuggable. */
export type WidgetStatus =
  | { state: "unknown" } // nothing published yet this launch
  | { state: "published"; at: number } // wrote and read it back; unix seconds
  | { state: "unavailable"; reason: UnavailableReason }
  | { state: "failed"; detail: string };

/**
 * Why there's no native module to publish through. Both are permanent for the
 * running binary — an OTA update can't add a native module, so the only fix is
 * installing a build that has one.
 */
export type UnavailableReason =
  | "expo-go" // Expo Go ships a fixed module set; widgets need a dev/preview build
  | "not-linked"; // custom binary, but built before ExtensionStorage was autolinked

// ExtensionStorage ships with @bacons/apple-targets and is autolinked at
// prebuild. requireOptionalNativeModule installs the Expo module host object if
// the runtime hasn't yet, then falls back to the bridge proxy — a raw peek at
// `globalThis.expo.modules` misses both paths.
interface ExtensionStorageModule {
  setString(key: string, value: string, group?: string): void;
  get(key: string, group?: string): string | null;
  reloadWidget(name?: string): void;
}

function nativeStorage(): ExtensionStorageModule | null {
  const mod = requireOptionalNativeModule<ExtensionStorageModule>("ExtensionStorage");
  return mod && typeof mod.setString === "function" && typeof mod.get === "function" ? mod : null;
}

/** Expo Go can never host the widget target — worth saying so by name. */
function unavailableReason(): UnavailableReason {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? "expo-go" : "not-linked";
}

export function publishWidgetData(summary: Summary): WidgetStatus {
  const storage = nativeStorage();
  if (!storage) return { state: "unavailable", reason: unavailableReason() };

  try {
    const win = monthWindow();
    const totals = monthTotals(summary.spendByDay ?? [], win);
    const payload = {
      asOf: summary.asOf,
      netWorthCents: summary.netWorth.cents,
      spark: summary.netWorth.spark.slice(-30).map((p) => p.cents),
      spentCents: summary.budgets.reduce((a, b) => a + b.spentCents, 0),
      budgetCents: summary.budgets.reduce((a, b) => a + b.limitCents, 0),
      ...budgetPace(summary),
      // Everything below backs the category / week / glance widgets. Derived
      // by the SAME helpers the Spending screen uses, so a widget can never
      // quietly disagree with the app it sits next to.
      monthLabel: win.label,
      monthSpentCents: totals.spentCents,
      priorMonthCents: totals.priorCents,
      categories: topCategories(summary, win),
      ...weekWindow(summary),
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

/**
 * Top spending categories this month. Names only — no merchants, no ids: a
 * Home Screen widget sits face-up on a desk, and "Food & Drink $612" is a very
 * different disclosure from a merchant tape.
 */
function topCategories(summary: Summary, win: MonthWindow) {
  const index = new Map((summary.categories ?? []).map((c) => [c.id, c]));
  return categorySpend(summary, index, win)
    .slice(0, MAX_WIDGET_CATEGORIES)
    .map((r) => ({ name: r.name, cents: r.cents, limitCents: r.budget?.limitCents ?? 0 }));
}

/**
 * The last 7 days ending today, plus the 7 before it for the delta. Days with
 * no spend are explicit zeros — a gap in the week is the signal, so the bars
 * have to keep their slots.
 */
function weekWindow(summary: Summary): { weekByDay: number[]; prevWeekCents: number } {
  const today = Math.floor(Date.now() / 86_400_000) * 86_400; // UTC midnight, seconds
  const byDay = new Map<number, number>();
  for (const p of summary.spendByDay ?? []) {
    const day = Math.floor(p.d / 86_400) * 86_400;
    byDay.set(day, (byDay.get(day) ?? 0) + p.cents);
  }

  const weekByDay: number[] = [];
  for (let i = 6; i >= 0; i--) weekByDay.push(byDay.get(today - i * 86_400) ?? 0);

  let prevWeekCents = 0;
  for (let i = 13; i >= 7; i--) prevWeekCents += byDay.get(today - i * 86_400) ?? 0;

  return { weekByDay, prevWeekCents };
}
