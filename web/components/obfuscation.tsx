"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OBF_COOKIE, DEFAULT_K, setScaleFactor } from "@/lib/scale";

const ONE_YEAR = 60 * 60 * 24 * 365;

function writeCookie(k: number) {
  document.cookie = `${OBF_COOKIE}=${k}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

/**
 * Seeds the client-side display scale during render — before any currency is
 * formatted further down the tree — so the hydrated output matches the
 * server-rendered HTML (both read the same cookie). Renders nothing.
 */
export function ScaleInit({ factor }: { factor: number }) {
  setScaleFactor(factor);
  return null;
}

/**
 * Privacy-mode control. Toggling (or changing the factor) writes the cookie,
 * optimistically updates the client scale, and calls router.refresh() so both
 * the server and client component trees re-render with the new scale.
 */
export function ObfuscationToggle({ initialFactor }: { initialFactor: number }) {
  const router = useRouter();
  const startEnabled = initialFactor > 1;
  const [enabled, setEnabled] = useState(startEnabled);
  const [k, setK] = useState(startEnabled ? initialFactor : DEFAULT_K);

  function apply(nextEnabled: boolean, nextK: number) {
    const factor = nextEnabled && nextK > 1 ? nextK : 1;
    setScaleFactor(factor); // optimistic; the refresh re-render reads this
    writeCookie(factor);
    router.refresh();
  }

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    apply(next, k);
  }

  function changeK(value: number) {
    const safe = Number.isFinite(value) && value > 1 ? Math.round(value) : 2;
    setK(safe);
    if (enabled) apply(true, safe);
  }

  return (
    <div className="flex items-center gap-1.5">
      {enabled && (
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          <span aria-hidden>÷</span>
          <input
            type="number"
            min={2}
            step={1}
            value={k}
            onChange={(e) => changeK(Number(e.target.value))}
            aria-label="Privacy factor (k)"
            className="w-12 rounded-md border border-line bg-[var(--panel)] px-1.5 py-0.5 text-right tabular text-[var(--paper)] focus:border-[var(--line-strong)] focus:outline-none"
          />
        </label>
      )}
      <Button
        variant={enabled ? "outline" : "ghost"}
        size="sm"
        onClick={toggle}
        aria-pressed={enabled}
        aria-label={enabled ? "Disable privacy mode" : "Enable privacy mode"}
        title={
          enabled
            ? `Privacy on — figures shown at 1/${k} of actual`
            : "Privacy mode — scale down all figures"
        }
      >
        {enabled ? <EyeOff size={15} /> : <Eye size={15} />}
        <span className="hidden sm:inline">{enabled ? "Hidden" : "Privacy"}</span>
      </Button>
    </div>
  );
}
