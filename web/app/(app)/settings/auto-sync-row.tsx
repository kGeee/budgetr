"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAutoSync } from "@/lib/actions-settings";
import { SettingRow } from "./setting-row";

/**
 * How often the Mac pulls from the bank on its own. The options and their
 * wording are passed in from the server (lib/auto-sync.ts) so this file stays
 * free of the database module that defines them.
 */
export function AutoSyncRow({
  hours,
  options,
  lastRun,
  paired,
}: {
  hours: number;
  options: { hours: number; label: string }[];
  /** "2 hours ago", or null when it has never run. */
  lastRun: string | null;
  paired: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  return (
    <SettingRow
      title="Sync accounts automatically"
      control={
        <select
          aria-label="Sync accounts automatically"
          value={hours}
          disabled={busy}
          onChange={(e) => {
            const next = Number(e.target.value);
            start(async () => {
              await setAutoSync(next);
              router.refresh();
            });
          }}
          className="h-11 rounded-xl border border-line bg-[var(--panel)] px-3 text-sm outline-none transition-colors hover:border-[var(--line-strong)] disabled:opacity-50"
        >
          {options.map((o) => (
            <option key={o.hours} value={o.hours}>
              {o.label}
            </option>
          ))}
        </select>
      }
    >
      Pulls new transactions, balances and holdings from your banks on a schedule while budgetr is
      running, instead of only when you press Sync.{" "}
      {paired
        ? "Your phone gets the result within a minute."
        : "A paired phone gets the result within a minute."}{" "}
      Each sync calls Plaid, which bills some plans per balance check.
      {hours > 0 && (
        <span className="mt-1 block text-[var(--paper)]">
          {lastRun ? `Last ran ${lastRun}.` : "Runs within a few minutes."}
        </span>
      )}
    </SettingRow>
  );
}
