import { cn } from "@/lib/utils";
import { categoryHue } from "@/lib/category-tint";

/**
 * The small ruled pieces every Spending view shares: a category's colour dot,
 * a share bar, a two-ended list row and the pill-shaped quiet link. Plain
 * markup with no hooks, so server and client views can both use them.
 */

/**
 * A category's identity dot. Uses the colour stored on the category when there
 * is one, otherwise a stable hue from the shared ring.
 */
export function CategoryDot({
  id,
  color,
  className,
}: {
  /** Category id, or its name for uncategorized rows. */
  id: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={
        color
          ? { background: color }
          : ({ "--tint-h": categoryHue(id), background: "var(--tint)" } as React.CSSProperties)
      }
      className={cn("h-2 w-2 shrink-0 rounded-[3px]", !color && "tint", className)}
    />
  );
}

/** The fill style for anything that should take a category's colour. */
export function categoryFill(id: string, color?: string | null): React.CSSProperties {
  return color
    ? { background: color }
    : ({ "--tint-h": categoryHue(id), background: "var(--tint)" } as React.CSSProperties);
}

/** A 4px share-of-total bar in the category's colour. */
export function ShareBar({
  pct,
  id,
  color,
}: {
  pct: number;
  id: string;
  color?: string | null;
}) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <span className="block h-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
      <span
        className={cn("block h-1 rounded-full", !color && "tint")}
        style={{ ...categoryFill(id, color), width: `${width}%`, minWidth: width > 0 ? 3 : 0 }}
      />
    </span>
  );
}

/** One line of a ruled list: what it is on the left, its figure on the right. */
export function RuledRow({
  children,
  figure,
  className,
}: {
  children: React.ReactNode;
  figure: React.ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "flex min-h-[46px] items-center justify-between gap-3 border-b border-line py-2 text-sm",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span className="mono shrink-0 tabular">{figure}</span>
    </li>
  );
}

/** Outline pill used for footer actions under a ruled table. */
export const quietPill =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-4 text-sm text-[var(--paper)] transition-colors hover:bg-[var(--panel-2)]";

/** One option in a segmented pill group (period, chart view). */
export const segment = (active: boolean) =>
  cn(
    "inline-flex min-h-9 items-center rounded-full px-3 text-xs transition-colors",
    active
      ? "bg-[var(--panel-2)] text-[var(--paper)]"
      : "text-[var(--muted)] hover:text-[var(--paper)]",
  );

export const segmentGroup = "inline-flex flex-wrap rounded-full border border-line p-[3px]";

export type CategoryShift = {
  /** Present when the shift came from a real category — keeps its dot colour stable. */
  categoryId?: string | null;
  category: string;
  icon: string | null;
  current: number;
  prev: number;
  delta: number;
};

const SHIFT_GRID =
  "grid grid-cols-[minmax(150px,1.4fr)_minmax(170px,1.4fr)_110px_70px] items-center gap-[18px]";

/** Category shifts against the prior period, as one ruled table. */
export function ShiftsTable({
  shifts,
  prevLabel,
  label,
  fmt,
}: {
  shifts: CategoryShift[];
  prevLabel: string;
  label: string;
  /** Money formatter — the caller owns currency and privacy mode. */
  fmt: (v: number) => string;
}) {
  return (
    <section aria-label={`Category shifts versus ${prevLabel}`}>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div
            className={`${SHIFT_GRID} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
          >
            <h2 className="whitespace-nowrap font-display text-lg tracking-tight text-[var(--paper)]">
              Category shifts · vs {prevLabel}
            </h2>
            <span>
              {prevLabel} → {label}
            </span>
            <span className="text-right">Change</span>
            <span className="text-right">%</span>
          </div>
          {shifts.map((s) => {
            const up = s.delta >= 0;
            const pct = s.prev > 0 ? (s.delta / s.prev) * 100 : null;
            const tone = up ? "text-[var(--coral)]" : "text-[var(--jade)]";
            return (
              <div key={s.category} className={`${SHIFT_GRID} min-h-[46px] border-b border-line text-sm`}>
                <span className="flex min-w-0 items-center gap-2.5 font-medium">
                  <CategoryDot id={s.categoryId ?? s.category} />
                  <span className="truncate">{s.category}</span>
                </span>
                <span className="mono text-[13px] text-[var(--muted)]">
                  {fmt(s.prev)} → {fmt(s.current)}
                </span>
                <span className={`mono text-right tabular ${tone}`}>
                  {up ? "+" : "−"}
                  {fmt(Math.abs(s.delta))}
                </span>
                <span className={`mono text-right text-[13px] ${tone}`}>
                  {pct == null ? "new" : `${up ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {shifts.length === 0 && (
        <p className="py-2 text-sm text-[var(--muted)]">
          No category changes to compare against {prevLabel}.
        </p>
      )}
    </section>
  );
}

