// Publishes the widget payload into the shared App Group and reloads the
// WidgetKit timelines. Keep the shape in sync with targets/widget/index.swift.
//
// The native module only exists in a dev/release build (@bacons/apple-targets
// links it at prebuild). In Expo Go the require fails and every call becomes
// a silent no-op — widgets are simply a real-build feature.

import type { Summary } from "@budgetr/core";

const APP_GROUP = "group.dev.budgetr.companion";

type StorageLike = { set(key: string, value: string): void };
let storage: StorageLike | null = null;
let reload: (() => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ExtensionStorage } = require("@bacons/apple-targets");
  storage = new ExtensionStorage(APP_GROUP);
  reload = () => ExtensionStorage.reloadWidget();
} catch {
  // Expo Go — no widget host, nothing to publish to.
}

export function publishWidgetData(summary: Summary): void {
  if (!storage) return;
  try {
    const payload = {
      asOf: summary.asOf,
      netWorthCents: summary.netWorth.cents,
      spark: summary.netWorth.spark.slice(-30).map((p) => p.cents),
      spentCents: summary.budgets.reduce((a, b) => a + b.spentCents, 0),
      budgetCents: summary.budgets.reduce((a, b) => a + b.limitCents, 0),
    };
    storage.set("widgetPayload", JSON.stringify(payload));
    reload?.();
  } catch {
    // Never let widget publishing break sync.
  }
}
