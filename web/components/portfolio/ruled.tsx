import { cn } from "@/lib/utils";

/**
 * The ruled-table language shared by the Investments tabs and the Trading desk:
 * tables sit directly on the canvas, a strong rule under the header, a hairline
 * under each row, figures in mono. No card, no panel fill, no side padding —
 * the first column starts at the page's left edge and the last ends at its right.
 *
 * Class strings rather than wrapper components so they compose with the
 * existing `<table>` markup (sortable headers, expandable rows, colSpans).
 */
export const ruled = {
  /** Wrap every table in this so phones scroll the table, not the page. */
  scroll: "overflow-x-auto",
  table: "w-full text-sm",
  headRow: "border-b border-[var(--line-strong)] text-left",
  /** Header cell: quiet sentence-case label. Add `text-right` for figures. */
  th: "whitespace-nowrap pb-2.5 pr-5 text-xs font-normal text-[var(--muted)] last:pr-0",
  row: "border-b border-line",
  /** Body cell. Rows read at ~52px like the renders. */
  td: "py-3.5 pr-5 align-middle last:pr-0",
  /** Dense body cell for chains, ladders and matrices. */
  tdDense: "py-2 pr-4 align-middle last:pr-0",
  /** A right-aligned mono figure. */
  num: "mono text-right tabular whitespace-nowrap",
  /** The closing Total row: no rule under it, label in the text face. */
  totalRow: "mono",
  totalLabel: "font-sans text-[var(--muted)]",
} as const;

/** Outlined pill used for footer and control-row actions (Import, Add, CSV…). */
export const pill =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-4 text-sm text-[var(--paper)] transition-colors hover:border-[var(--brass-dim)] disabled:opacity-50";

/** Select styled as a control-row pill. */
export const pillSelect =
  "min-h-10 rounded-full border border-[var(--line-strong)] bg-transparent px-4 text-sm text-[var(--paper)] outline-none transition-colors hover:border-[var(--brass-dim)] focus:border-[var(--brass-dim)]";

/** A pill-shaped segmented control (range, mode, view toggles). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** Accessible name for the group, e.g. "Range". */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("mono inline-flex rounded-full border border-line p-[3px] text-xs", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "min-h-8 min-w-10 rounded-full px-3.5 transition-colors",
            value === o.value
              ? "bg-[var(--panel-2)] text-[var(--paper)]"
              : "text-[var(--muted)] hover:text-[var(--paper)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A thin proportional bar. `pct` is the fill as a percent of the track — scale
 * it to the largest row yourself so the biggest value fills the track.
 */
export function Bar({
  pct,
  tone = "brass",
  className,
}: {
  pct: number;
  tone?: "brass" | "jade" | "coral" | "muted";
  className?: string;
}) {
  const fill =
    tone === "jade"
      ? "bg-[var(--jade)]"
      : tone === "coral"
        ? "bg-[var(--coral)]"
        : tone === "muted"
          ? "bg-[var(--muted)]"
          : "bg-[var(--brass)]";
  const w = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <span
      aria-hidden
      className={cn("block h-1 overflow-hidden rounded-full bg-[var(--panel-2)]", className)}
    >
      <span className={cn("block h-1 rounded-full", fill)} style={{ width: `${w}%` }} />
    </span>
  );
}

/** The quiet line under a table: a note on the left, actions on the right. */
export function RuledFooter({
  note,
  children,
  className,
}: {
  note?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5 text-[13px] text-[var(--muted)]",
        className,
      )}
    >
      <span>{note}</span>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A label/value pair in a ruled figure strip that sits beside a hero. */
export function SideFigure({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "jade" | "coral" | "brass" | "muted";
  sub?: React.ReactNode;
}) {
  const color =
    tone === "jade"
      ? "text-[var(--jade)]"
      : tone === "coral"
        ? "text-[var(--coral)]"
        : tone === "brass"
          ? "text-[var(--brass)]"
          : tone === "muted"
            ? "text-[var(--muted)]"
            : "text-[var(--paper)]";
  return (
    <div className="flex flex-col gap-0.5 border-l border-line px-6 pt-3 first:border-l-0 first:pl-0 last:pr-0">
      <dt className="text-[13px] text-[var(--muted)]">{label}</dt>
      <dd className={cn("mono text-sm whitespace-nowrap", color)}>{value}</dd>
      {sub && <dd className="text-xs text-[var(--muted)]">{sub}</dd>}
    </div>
  );
}

/**
 * Hero on the left, its supporting figures on the right, on one baseline — the
 * opening line of every statement page. Wraps to two rows on narrow screens.
 */
export function HeroLine({
  hero,
  children,
}: {
  hero: React.ReactNode;
  /** <SideFigure> elements. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
      {hero}
      {children && <dl className="flex flex-wrap gap-y-3 border-t border-line">{children}</dl>}
    </div>
  );
}
