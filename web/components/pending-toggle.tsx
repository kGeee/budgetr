"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { setCountPending } from "@/lib/actions-settings";

/**
 * Controls for the "count pending transactions" preference (see lib/pending.ts).
 * Both variants write the same server-side setting and refresh, so every spend
 * figure in the app re-reads it.
 */

function useToggle(on: boolean) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const toggle = () =>
    start(async () => {
      await setCountPending(!on);
      router.refresh();
    });
  return { busy, toggle };
}

function describe(on: boolean, count: number, amount: number) {
  const money = formatCurrency(amount);
  if (count === 0) {
    return on
      ? "Pending charges are counted as spending (nothing pending right now)"
      : "Pending charges are left out of spending (nothing pending right now)";
  }
  return on
    ? `Counting ${count} pending charge${count === 1 ? "" : "s"} (${money}) as spending — click to leave them out`
    : `${count} pending charge${count === 1 ? "" : "s"} (${money}) not counted — click to include them`;
}

/**
 * Header control. Hidden when there is nothing pending and the preference is
 * off, since it would then change no number on screen — the Settings page keeps
 * it reachable.
 */
export function PendingToggle({
  on,
  count,
  amount,
}: {
  on: boolean;
  count: number;
  amount: number;
}) {
  const { busy, toggle } = useToggle(on);
  if (!on && count === 0) return null;

  return (
    <Button
      variant={on ? "outline" : "ghost"}
      size="sm"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={describe(on, count, amount)}
    >
      <Clock size={15} />
      <span className="hidden sm:inline">
        {on ? "Pending in" : `${count} pending`}
      </span>
    </Button>
  );
}

/** Settings-page variant: an explicit on/off pair with room for the numbers. */
export function PendingSwitch({
  on,
  count,
  amount,
}: {
  on: boolean;
  count: number;
  amount: number;
}) {
  const { busy, toggle } = useToggle(on);

  return (
    <div className="flex shrink-0 items-center gap-3">
      {count > 0 && (
        <span className="text-xs text-[var(--muted)]">
          {count} pending · <span className="mono">{formatCurrency(amount)}</span>
        </span>
      )}
      <button
        role="switch"
        aria-checked={on}
        aria-label="Count pending transactions as spending"
        onClick={toggle}
        disabled={busy}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-40 ${
          on ? "border-[var(--brass-dim)] bg-[var(--brass)]" : "border-line bg-[var(--panel-2)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all ${
            on ? "left-[1.4rem] bg-[var(--on-brass)]" : "left-0.5 bg-[var(--faint)]"
          }`}
        />
      </button>
    </div>
  );
}
