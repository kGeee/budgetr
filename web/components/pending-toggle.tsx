"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { setCountPending } from "@/lib/actions-settings";
import { Switch } from "@/app/(app)/settings/switch";

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
        <span className="mono text-xs text-[var(--muted)]">
          {count} pending · <span className="mono">{formatCurrency(amount)}</span>
        </span>
      )}
      <Switch
        on={on}
        label="Count pending transactions as spending"
        onToggle={toggle}
        disabled={busy}
      />
    </div>
  );
}
