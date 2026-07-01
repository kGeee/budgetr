import { parseOccSymbol } from "@/lib/options";

/**
 * Pure allocation math for the Investments view: asset-class classification,
 * generic value-weighted grouping (asset class + geography), concentration
 * warnings, and drift-from-target rebalancing suggestions. Kept free of React
 * and the DB so it can run in a server component, a client component, or a test.
 */

export type AssetClass = "stocks" | "bonds" | "cash" | "crypto" | "options";

/** Every asset class, in display order. */
export const ASSET_CLASSES: AssetClass[] = ["stocks", "bonds", "cash", "crypto", "options"];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  stocks: "Stocks",
  bonds: "Bonds",
  cash: "Cash",
  crypto: "Crypto",
  options: "Options",
};

/** Stable per-class colors, aligned with the editorial palette in charts.tsx. */
export const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  stocks: "#7fb2e0",
  bonds: "#cbb07c",
  cash: "#6fe3a6",
  crypto: "#b59ce0",
  options: "#f0897b",
};

/** Region shown for positions with no geography override set. */
export const UNCLASSIFIED_REGION = "Unclassified";

/** The minimal holding shape the allocation math needs. */
export type AllocHolding = {
  ticker: string | null;
  /** Plaid security type or a manual holding's type (equity, etf, crypto, …). */
  securityType: string | null;
  /** Symbol-scoped key the overrides are stored under (see sectorKeyFor). */
  sectorKey: string;
};

function normalizeAssetClass(value: string | null | undefined): AssetClass | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return (ASSET_CLASSES as string[]).includes(v) ? (v as AssetClass) : null;
}

/**
 * Classify a holding into a coarse asset class. A user override (keyed by
 * sectorKey) always wins; otherwise OCC option symbols are `options` and the
 * rest is inferred from the security type, defaulting to `stocks`.
 */
export function assetClassFor(
  h: AllocHolding,
  override?: string | null,
): AssetClass {
  const forced = normalizeAssetClass(override);
  if (forced) return forced;

  // An OCC-symbol leg is an option regardless of how Plaid types it.
  if (parseOccSymbol(h.ticker)) return "options";

  const t = (h.securityType ?? "").toLowerCase();
  if (!t) return "stocks";
  if (t.includes("crypto")) return "crypto";
  if (t.includes("option") || t.includes("derivative") || t.includes("warrant"))
    return "options";
  if (
    t.includes("fixed income") ||
    t.includes("bond") ||
    t.includes("treasury") ||
    t.includes("fixed_income")
  )
    return "bonds";
  if (t.includes("cash") || t.includes("money market")) return "cash";
  // equity, etf, mutual fund, stock, and anything unrecognized → stocks.
  return "stocks";
}

export type AllocSlice = {
  /** Grouping key (asset class id, region name, …). */
  key: string;
  /** Human label shown in charts and tables. */
  label: string;
  value: number;
  count: number;
};

/**
 * Value-weighted grouping shared by the asset-class and geography breakdowns.
 * `classify` maps each item to its bucket; empty buckets are dropped and the
 * result is ranked by value, largest first.
 */
export function buildAllocation<T>(
  items: T[],
  classify: (item: T) => { key: string; label: string },
  valueOf: (item: T) => number,
): AllocSlice[] {
  const agg = new Map<string, AllocSlice>();
  for (const item of items) {
    const value = valueOf(item);
    const { key, label } = classify(item);
    const cur = agg.get(key);
    if (cur) {
      cur.value += value;
      cur.count += 1;
    } else {
      agg.set(key, { key, label, value, count: 1 });
    }
  }
  return Array.from(agg.values()).sort((a, b) => b.value - a.value);
}

export type ConcentrationItem = {
  /** Aggregation key — ticker (underlying for options) or holding name. */
  key: string;
  label: string;
  value: number;
};

export type ConcentrationWarning = {
  key: string;
  label: string;
  value: number;
  /** Share of the whole portfolio, percent. */
  pct: number;
};

/**
 * Flag single positions that make up `threshold`%+ of the portfolio. Items are
 * aggregated by key first (so multiple lots / option legs of one underlying
 * combine), then anything over the line is returned, most-concentrated first.
 */
export function detectConcentration(
  items: ConcentrationItem[],
  total: number,
  threshold = 25,
): ConcentrationWarning[] {
  if (total <= 0) return [];
  const agg = new Map<string, { label: string; value: number }>();
  for (const it of items) {
    const cur = agg.get(it.key);
    if (cur) cur.value += it.value;
    else agg.set(it.key, { label: it.label, value: it.value });
  }
  return Array.from(agg.entries())
    .map(([key, { label, value }]) => ({ key, label, value, pct: (value / total) * 100 }))
    .filter((w) => w.pct >= threshold)
    .sort((a, b) => b.pct - a.pct);
}

export type TargetDimension = "class" | "sector" | "ticker";

/** Compose a namespaced allocation-target key. */
export function targetKeyFor(dimension: TargetDimension, name: string): string {
  const n = dimension === "ticker" ? name.trim().toUpperCase() : name.trim();
  return `${dimension}:${n}`;
}

/** Split a namespaced target key back into its dimension + display label. */
export function parseTargetKey(key: string): { dimension: TargetDimension; name: string } {
  const idx = key.indexOf(":");
  const rawDim = idx >= 0 ? key.slice(0, idx) : "class";
  const name = idx >= 0 ? key.slice(idx + 1) : key;
  const dimension: TargetDimension =
    rawDim === "sector" || rawDim === "ticker" ? rawDim : "class";
  return { dimension, name };
}

/** Human-readable label for a target key (asset classes get their pretty name). */
export function labelForTargetKey(key: string): string {
  const { dimension, name } = parseTargetKey(key);
  if (dimension === "class") {
    const cls = normalizeAssetClass(name);
    return cls ? ASSET_CLASS_LABELS[cls] : name;
  }
  return name;
}

export type DriftRow = {
  key: string;
  label: string;
  dimension: TargetDimension;
  targetPct: number;
  currentPct: number;
  currentValue: number;
  /** current − target, in points. Positive = overweight. */
  driftPct: number;
  /** Dollars to move to hit target. Positive = buy more, negative = trim. */
  deltaValue: number;
};

/**
 * Compare each user-set target against the live actual weight and suggest the
 * dollar move to close the gap. `current` maps a target key to its present
 * weight/value; keys with no current position read as 0. Ranked by the size of
 * the drift so the worst offenders sort to the top.
 */
export function computeDrift(
  targets: Record<string, number>,
  current: Record<string, { pct: number; value: number }>,
  total: number,
): DriftRow[] {
  return Object.entries(targets)
    .map(([key, targetPct]) => {
      const cur = current[key] ?? { pct: 0, value: 0 };
      const { dimension } = parseTargetKey(key);
      const targetValue = (total * targetPct) / 100;
      return {
        key,
        label: labelForTargetKey(key),
        dimension,
        targetPct,
        currentPct: cur.pct,
        currentValue: cur.value,
        driftPct: cur.pct - targetPct,
        deltaValue: targetValue - cur.value,
      };
    })
    .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}
