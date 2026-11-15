import { cn } from "@/lib/utils";

/**
 * Small pieces shared by the Chain page's three modes (chain, vol, LEAPS).
 * Everything here sits on the canvas: a display-face title over a strong rule,
 * outlined pills for expiries, label/value rows under a hairline.
 */

/** Section title in the display face with a quiet qualifier and an action slot. */
export function DeskHead({
  title,
  sub,
  action,
  ruled = true,
  className,
}: {
  title: string;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  /** Strong rule under the title. Off when a table header supplies the rule. */
  ruled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
        ruled && "border-b border-[var(--line-strong)] pb-2.5",
        className,
      )}
    >
      <h2 className="font-display text-lg tracking-tight">
        {title}
        {sub != null && (
          <span className="ml-2 font-sans text-xs font-normal tracking-normal text-[var(--muted)]">
            {sub}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}

/** One outlined pill in a row of choices (expiries, templates). */
export function ChoicePill({
  on,
  onClick,
  disabled,
  title,
  mono = true,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className={cn(
        "min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        mono ? "mono text-xs" : "text-[13px]",
        on
          ? "border-[var(--line-strong)] bg-[var(--panel-2)] text-[var(--paper)]"
          : "border-line text-[var(--muted)] hover:text-[var(--paper)]",
      )}
    >
      {children}
    </button>
  );
}

/** A label on the left, a mono figure on the right, a hairline under both. */
export function FigureRow({
  label,
  sub,
  tone,
  children,
}: {
  label: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "jade" | "coral" | "brass";
  children: React.ReactNode;
}) {
  const color =
    tone === "jade"
      ? "text-[var(--jade)]"
      : tone === "coral"
        ? "text-[var(--coral)]"
        : tone === "brass"
          ? "text-[var(--brass)]"
          : "text-[var(--paper)]";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm">
      <span className="min-w-0">
        <span className={cn("block", sub == null && "text-[var(--muted)]")}>{label}</span>
        {sub != null && <span className="block text-xs text-[var(--muted)]">{sub}</span>}
      </span>
      <span className={cn("mono whitespace-nowrap", color)}>{children}</span>
    </div>
  );
}

/** A quiet on-canvas notice for "nothing to show here" states. */
export function DeskNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "max-w-[70ch] border-t border-line pt-4 text-sm leading-relaxed text-[var(--muted)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Underlined tab used for lenses and in-page views. */
export function LensTab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
        on
          ? "border-[var(--brass)] text-[var(--paper)]"
          : "border-transparent text-[var(--muted)] hover:text-[var(--paper)]",
      )}
    >
      {children}
    </button>
  );
}
