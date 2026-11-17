import { cn } from "@/lib/utils";

/**
 * The one on/off control Settings uses. A 52×28 track inside a 44px-tall hit
 * area; the state is carried by `aria-checked` and the knob's position, with
 * colour as the third cue. No hooks, so server and client components share it.
 */
export function Switch({
  on,
  label,
  onToggle,
  disabled,
  id,
  className,
}: {
  on: boolean;
  /** Accessible name — the row's title, said in full. */
  label: string;
  onToggle: () => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "flex h-11 w-[52px] shrink-0 cursor-pointer items-center disabled:cursor-default disabled:opacity-40",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-7 w-[52px] items-center rounded-full border px-[3px] transition-colors duration-200",
          on
            ? "justify-end border-[var(--jade-deep)] bg-[var(--jade-deep)]"
            : "justify-start border-[var(--line-strong)] bg-[var(--panel-2)]",
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full transition-colors duration-200",
            on ? "bg-[var(--paper)]" : "bg-[var(--muted)]",
          )}
        />
      </span>
    </button>
  );
}
