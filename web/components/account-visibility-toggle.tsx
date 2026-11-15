"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTransition } from "react";
import { setAccountExcluded } from "@/lib/actions";

/**
 * Per-account hide/show control on the Accounts page. Toggling flips the
 * `excluded` overlay flag, which drops the account from net worth, the sidebar,
 * cashflow cash, and the accounts total (server action revalidates the layout).
 */
export function AccountVisibilityToggle({ id, excluded }: { id: string; excluded: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={excluded}
      onClick={() => startTransition(() => setAccountExcluded(id, !excluded))}
      aria-label={excluded ? "Show account" : "Hide account"}
      title={excluded ? "Hidden — click to count it again" : "Hide from totals & sidebar"}
      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--paper)] disabled:opacity-50"
    >
      {excluded ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
      {excluded ? "Show" : "Hide"}
    </button>
  );
}
