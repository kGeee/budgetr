"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { setCountPending } from "@/lib/actions-settings";

/**
 * Control for the "count pending transactions" preference (see lib/pending.ts).
 * It writes the server-side setting and refreshes, so every spend
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
