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
      onClick={() => startTransition(() => setAccountExcluded(id, !excluded))}
      aria-label={excluded ? "Show account" : "Hide account"}
      title={excluded ? "Hidden — click to show" : "Hide from totals & sidebar"}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line transition-colors hover:bg-[var(--panel-2)] disabled:opacity-50 ${
        excluded ? "text-[var(--muted)]" : "text-[var(--faint)] hover:text-[var(--paper)]"
      }`}
    >
      {excluded ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  );
}
