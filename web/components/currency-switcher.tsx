"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setDisplayCurrency as persistDisplayCurrency } from "@/lib/actions-settings";
import {
  SUPPORTED_CURRENCIES,
  setDisplayCurrency,
  setRatesMap,
} from "@/lib/currency";

/**
 * Seeds the client-side display currency + FX rate map during render — before
 * any figure is formatted further down the tree — so hydrated output matches the
 * server-rendered HTML (both read the same cookie + cached rates). Renders
 * nothing.
 */
export function CurrencyInit({
  currency,
  rates,
}: {
  currency: string;
  rates: Record<string, number>;
}) {
  setDisplayCurrency(currency);
  setRatesMap(rates);
  return null;
}

/**
 * Display-currency dropdown. Picking a currency persists it (cookie +
 * app_settings) and refreshes the FX cache via the server action, then the
 * router re-renders both trees with everything converted to the new unit.
 */
export function CurrencySwitcher({ current }: { current: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pick(code: string) {
    setOpen(false);
    if (code === current) return;
    // Optimistically seed so this tick reads the new unit; the action + refresh
    // then reconciles server + client with freshly cached rates.
    setDisplayCurrency(code);
    startTransition(async () => {
      await persistDisplayCurrency(code);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Display currency"
        title="Display currency — convert all figures to this unit"
      >
        <Coins size={15} />
        <span className="tabular">{current}</span>
        <ChevronDown size={13} className="opacity-60" />
      </Button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="listbox"
            className="absolute right-0 z-40 mt-1.5 w-36 overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] py-1 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.6)]"
          >
            {SUPPORTED_CURRENCIES.map((code) => {
              const active = code === current;
              return (
                <li key={code}>
                  <button
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(code)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-sm text-[var(--paper)] transition-colors hover:bg-[var(--panel-2)]"
                  >
                    <span className="tabular">{code}</span>
                    {active && <Check size={14} className="text-[var(--jade)]" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
