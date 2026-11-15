"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTradingDesk } from "@/lib/actions-settings";
import { SettingRow } from "./setting-row";

/**
 * The trading-desk switch, plus the notice shown when someone arrives from a
 * desk page (lib/trading-desk.ts redirects Markets / Options / Fundamentals to
 * /settings#trading-desk while the desk is off). The hash is read on the
 * client: CSS `:target` doesn't match after a client-side redirect, because
 * the router moves with pushState, which never updates it.
 */

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function TradingDeskSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => ""
  );
  const arrived = hash === "#trading-desk" && !on;

  // The browser's own jump to the fragment fires before the streamed sections
  // above have laid out (and the router restores scroll to the top after it),
  // so a redirected visitor landed on License, never seeing why they're here.
  useEffect(() => {
    if (!arrived) return;
    document.getElementById("trading-desk")?.scrollIntoView({ block: "start" });
  }, [arrived]);

  const toggle = () =>
    start(async () => {
      await setTradingDesk(!on);
      router.refresh();
    });

  return (
    <div>
      {arrived && (
        <p className="mt-4 rounded-[var(--radius)] border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] px-4 py-3 text-sm">
          That page is part of the trading desk, which is off. Switch it on to bring Markets,
          Options and Fundamentals back.
        </p>
      )}
      <SettingRow
        title="Show the trading desk"
        control={
          <button
            role="switch"
            aria-checked={on}
            aria-label="Show the trading desk"
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
        }
      >
        Adds the trading tools to the sidebar: the Markets watchlist, the Options desk, and SEC
        Fundamentals. Off by default — budgetr works fully without them.
      </SettingRow>
    </div>
  );
}
