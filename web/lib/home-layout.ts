/**
 * Home's layout rules, kept pure so they can be tested without a database or a
 * DOM: the stock widget order, how a flat widget list becomes the page's bands
 * (a full-width figure, then a wide column beside a narrow one), and the small
 * sums behind the "this month" strip.
 *
 * Type-only imports from the query layer, so the client grid can use this
 * module without pulling the database into the bundle.
 */
import type { WidgetConfig, WidgetType } from "@/lib/queries";

export type DefaultWidget = { type: WidgetType; config?: WidgetConfig };

/**
 * The stock Home board. Read top to bottom it is the page: the net-worth hero
 * across the top, then recent activity leading the wide column and budgets and
 * upcoming bills leading the narrow one. The retrospective widgets follow in
 * their own columns.
 */
export const OVERVIEW_DEFAULT_WIDGETS: DefaultWidget[] = [
  { type: "net-worth-summary" },
  { type: "recent-activity", config: { limit: 6 } },
  { type: "budget-summary" },
  { type: "upcoming-bills", config: { days: 14 } },
  { type: "spending-review" },
  { type: "cashflow", config: { months: 6 } },
  { type: "spend-by-category", config: { days: 30 } },
];

/** The board as it was seeded before the statement layout, in seed order. */
const LEGACY_DEFAULT_TYPES: WidgetType[] = [
  "net-worth-summary",
  "spending-review",
  "cashflow",
  "spend-by-category",
  "budget-summary",
  "recent-activity",
  "upcoming-bills",
];

/**
 * Where a widget sits. `full` spans the page; `main` and `side` share a row as
 * the wide and narrow columns.
 */
export type WidgetSlot = "full" | "main" | "side";

export const WIDGET_SLOT: Record<WidgetType, WidgetSlot> = {
  "net-worth-summary": "full",
  "net-worth": "full",
  "daily-spend": "full",
  "review-queue": "main",
  "recent-activity": "main",
  "spending-review": "main",
  cashflow: "main",
  "budget-summary": "side",
  "upcoming-bills": "side",
  "spend-by-category": "side",
  "top-vendors": "side",
};

export type Band<T> =
  | { kind: "full"; item: T }
  | { kind: "columns"; main: T[]; side: T[] };

/**
 * Fold an ordered widget list into bands. A full-width widget is a band of its
 * own; every run of column widgets between two full-width ones becomes a single
 * two-column band, each widget keeping its order within its column.
 */
export function layoutBands<T>(items: T[], slotOf: (item: T) => WidgetSlot): Band<T>[] {
  const bands: Band<T>[] = [];
  let open: Extract<Band<T>, { kind: "columns" }> | null = null;
  for (const item of items) {
    const slot = slotOf(item);
    if (slot === "full") {
      open = null;
      bands.push({ kind: "full", item });
      continue;
    }
    if (!open) {
      open = { kind: "columns", main: [], side: [] };
      bands.push(open);
    }
    open[slot].push(item);
  }
  return bands;
}

/**
 * An untouched board seeded in the old order is shown in the current stock
 * order. Nothing is written: the moment a widget is added, removed or dragged
 * the stored order no longer matches the old seed and is used as it stands.
 */
export function presentOrder<T extends { id: string; type: string }>(widgets: T[]): T[] {
  const untouched =
    widgets.length === LEGACY_DEFAULT_TYPES.length &&
    widgets.every((w, i) => w.id === `dw_ov_${i}` && w.type === LEGACY_DEFAULT_TYPES[i]);
  if (!untouched) return widgets;
  const rank = new Map(OVERVIEW_DEFAULT_WIDGETS.map((w, i) => [w.type as string, i]));
  return [...widgets].sort((a, b) => (rank.get(a.type) ?? 99) - (rank.get(b.type) ?? 99));
}

export type MonthPace = {
  /** 1-based day of the budget month; the last day once the month is over. */
  day: number;
  daysInMonth: number;
  daysLeft: number;
  /** Share of the month gone, 0–1. Where the "today" tick sits on a bar. */
  elapsed: number;
};

/**
 * How far through the budget month `today` is. The budget month can trail the
 * calendar (it falls back to the last month with transactions), in which case
 * the month is over and the tick sits at the end.
 */
export function monthPace(month: string, today: Date): MonthPace {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const current = today.getFullYear() === y && today.getMonth() + 1 === m;
  const past = today.getFullYear() > y || (today.getFullYear() === y && today.getMonth() + 1 > m);
  const day = current ? today.getDate() : past ? daysInMonth : 0;
  return { day, daysInMonth, daysLeft: daysInMonth - day, elapsed: day / daysInMonth };
}

export type PaceState = "none" | "over-budget" | "over-pace" | "under-pace" | "on-pace";

/**
 * Spending against the calendar: over budget outright, or ahead of / behind the
 * straight line from nothing spent on the 1st to everything spent on the last.
 * Within two points of the line counts as on pace.
 */
export function paceState(totalBudget: number, totalSpent: number, elapsed: number): PaceState {
  if (totalBudget <= 0) return "none";
  const used = totalSpent / totalBudget;
  if (used > 1) return "over-budget";
  if (used > elapsed + 0.02) return "over-pace";
  if (used < elapsed - 0.02) return "under-pace";
  return "on-pace";
}

export type PortfolioTotals = {
  /** Market value across every holding with a value. */
  value: number;
  /** Value less cost, over the holdings that report both. Null when none do. */
  gain: number | null;
  gainPct: number | null;
  count: number;
};

/** Holdings rolled up to one value and one gain against cost. */
export function portfolioTotals(
  holdings: { value: number | null; costBasis: number | null }[],
): PortfolioTotals {
  let value = 0;
  let pricedValue = 0;
  let cost = 0;
  let count = 0;
  for (const h of holdings) {
    if (h.value == null) continue;
    count += 1;
    value += h.value;
    if (h.costBasis != null && h.costBasis > 0) {
      pricedValue += h.value;
      cost += h.costBasis;
    }
  }
  const gain = cost > 0 ? pricedValue - cost : null;
  return { value, gain, gainPct: gain != null ? (gain / cost) * 100 : null, count };
}
