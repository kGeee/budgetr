import { cn } from "@/lib/utils";

/**
 * The "statement" grammar: one figure, one sentence that says what it means,
 * then ruled figures and tables sitting directly on the canvas. These replace
 * the stack of equal-weight cards each page used to open with — a page gets one
 * hero, and everything under it is a rule, not a box.
 */

type Tone = "default" | "jade" | "coral" | "brass" | "muted";

const TONE: Record<Tone, string> = {
  default: "text-[var(--paper)]",
  jade: "text-[var(--jade)]",
  coral: "text-[var(--coral)]",
  brass: "text-[var(--brass)]",
  muted: "text-[var(--muted)]",
};

/**
 * A money figure with its cents set one rank quieter. Takes the already
 * formatted string so privacy mode and the display currency are respected —
 * a masked value has no decimal point and simply renders whole.
 */
export function Figure({ value, className }: { value: string; className?: string }) {
  const dot = value.lastIndexOf(".");
  // Exactly two digits, and not a percentage — "25.3%" has no cents to quiet.
  const hasCents = dot > 0 && /^\d{2}[^\d%]*$/.test(value.slice(dot + 1));
  if (!hasCents) return <span className={className}>{value}</span>;
  return (
    <span className={className}>
      {value.slice(0, dot)}
      <span className="text-[var(--muted)]">{value.slice(dot)}</span>
    </span>
  );
}

/** The page's one editorial number, with the sentence that reads it for you. */
export function Hero({
  eyebrow,
  figure,
  tone = "default",
  verdict,
  children,
  className,
}: {
  eyebrow: string;
  /** Formatted figure, e.g. the output of formatCurrency(). */
  figure: string;
  tone?: Tone;
  verdict?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3.5", className)}>
      <p className="eyebrow">{eyebrow}</p>
      <p
        className={cn(
          "display-1 font-display text-5xl tabular sm:text-6xl",
          TONE[tone],
        )}
      >
        <Figure value={figure} />
      </p>
      {verdict && <Verdict>{verdict}</Verdict>}
      {children}
    </div>
  );
}

/** One sentence in the display face. Wrap the part that matters in <Mark>. */
export function Verdict({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("max-w-[46ch] font-display text-lg leading-snug sm:text-xl", className)}>
      {children}
    </p>
  );
}

export function Mark({ tone = "jade", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cn("tabular", TONE[tone])}>{children}</span>;
}

/** A single ruled line of supporting figures under a hero. */
export function StatStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <dl className={cn("flex flex-wrap gap-y-3 border-t border-line pt-3.5", className)}>{children}</dl>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="min-w-[9rem] flex-1 border-l border-line px-5 first:border-l-0 first:pl-0">
      <dt className="text-[13px] text-[var(--muted)]">{label}</dt>
      <dd className={cn("mono mt-0.5 text-sm", TONE[tone])}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-[var(--muted)]">{sub}</dd>}
    </div>
  );
}

/** Section title in the display face over a strong rule, with a count and a link slot. */
export function SectionHead({
  title,
  count,
  action,
  id,
  className,
}: {
  title: string;
  count?: number | string;
  action?: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-strong)] pb-2.5",
        className,
      )}
    >
      <h2 id={id} className="font-display text-lg tracking-tight">
        {title}
        {count != null && <span className="mono ml-2 text-xs text-[var(--muted)]">{count}</span>}
      </h2>
      {action}
    </div>
  );
}
