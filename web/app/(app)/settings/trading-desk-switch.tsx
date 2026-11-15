"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTradingDesk } from "@/lib/actions-settings";
import { SettingRow } from "./setting-row";
import { Switch } from "./switch";

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
        <p role="status" className="border-b border-line py-3.5 text-sm text-[var(--brass)]">
          That page is part of the trading desk, which is off. Switch it on to bring Markets,
          Options and Fundamentals back.
        </p>
      )}
      <SettingRow
        title="Show the trading desk"
        control={
          <Switch on={on} label="Show the trading desk" onToggle={toggle} disabled={busy} />
        }
      >
        Adds the trading tools to the sidebar: the Markets watchlist, the Options desk, and SEC
        Fundamentals. Off by default — budgetr works fully without them.
      </SettingRow>
    </div>
  );
}
