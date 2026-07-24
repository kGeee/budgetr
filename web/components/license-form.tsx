"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import { activateLicense, deactivateLicense } from "@/lib/actions-license";

/**
 * Paste-a-key activation form. Shared by the full-screen license gate and the
 * Settings panel. On success it refreshes the route so the gate lifts / the
 * status card re-renders from the server.
 */
export function LicenseForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okName, setOkName] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const trimmed = key.trim();
    if (!trimmed || pending) return;
    setError(null);
    start(async () => {
      const res = await activateLicense(trimmed);
      if (res.ok) {
        setOkName(res.sub);
        setKey("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (okName) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--jade)_35%,transparent)] bg-[color-mix(in_srgb,var(--jade)_10%,transparent)] px-4 py-3 text-sm text-[var(--jade)]">
        <Check size={16} /> License activated — thanks, {okName}.
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <KeyRound
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]"
          />
          <input
            autoFocus={autoFocus}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="BGTR1.…"
            spellCheck={false}
            aria-label="License key"
            aria-invalid={Boolean(error)}
            className="mono h-11 w-full rounded-full border border-line bg-[var(--panel)] pl-9 pr-4 text-sm text-[var(--paper)] outline-none placeholder:text-[var(--faint)] focus:border-[var(--brass-dim)]"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !key.trim()}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--brass)] px-5 text-sm font-medium text-[var(--on-brass,#1a1205)] transition hover:brightness-105 disabled:opacity-50"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          Activate
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-[var(--coral)]">{error}</p>}
    </div>
  );
}

/** Removes the stored license (reverts to trial/expired). Used in Settings. */
export function LicenseRemoveButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("Remove this license from this device?")) return;
        start(async () => {
          await deactivateLicense();
          router.refresh();
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-sm text-[var(--muted)] transition hover:border-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50"
    >
      <Trash2 size={14} /> Remove license
    </button>
  );
}
