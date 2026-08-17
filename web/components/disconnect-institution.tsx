"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { disconnectItem, type DisconnectResult } from "@/lib/actions";

/**
 * Remove a linked institution — the missing half of Plaid Link.
 *
 * Connecting was always one click; disconnecting was a SQL statement. That gap
 * matters more here than in most apps: budgetr's whole pitch is that the data is
 * yours and stays on your machine, and an account you can add but not remove
 * quietly contradicts it. A closed card or a mis-linked bank had no exit.
 *
 * This is deliberately a two-step, type-to-confirm destructive action rather
 * than a menu item with an "are you sure". Deleting the item cascades through
 * accounts to transactions, holdings and recurring streams — years of
 * categorisation, splits, notes and tags go with it, and there is no undo. The
 * dialog states the exact count before asking, and hiding (the reversible
 * option) is offered right next to it, because most people reaching for this
 * actually want to hide.
 */
export function DisconnectInstitution({
  itemId,
  institution,
  accountCount,
}: {
  itemId: string;
  institution: string;
  accountCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DisconnectResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Matching on the institution's own name means muscle memory can't carry you
  // through — you have to look at which one you're deleting.
  const confirmed = typed.trim().toLowerCase() === institution.trim().toLowerCase();

  function close() {
    setOpen(false);
    setTyped("");
    setError(null);
  }

  function run() {
    if (!confirmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await disconnectItem(itemId);
        // The row is gone either way; a failed Plaid revoke is reported rather
        // than presented as success, since the link is still live upstream.
        if (res.revokedAtPlaid) close();
        else {
          setResult(res);
          setOpen(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not disconnect.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Disconnect ${institution}`}
        title={`Disconnect ${institution}`}
        className="rounded-lg p-1.5 text-[var(--faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--coral)_12%,transparent)] hover:text-[var(--coral)]"
      >
        <Trash2 size={15} />
      </button>

      {/* The upstream revoke failed: the local data is gone but Plaid still holds
          a live link, which the user needs to know to clear it themselves. */}
      {result && !result.revokedAtPlaid && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border border-[var(--brass-dim)] bg-[var(--panel)] p-4 text-sm shadow-[var(--elev-2)]"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle size={15} className="text-[var(--brass)]" />
            {result.institution} removed locally
          </p>
          <p className="mt-1.5 text-[var(--muted)]">
            {result.accountsRemoved} account{result.accountsRemoved === 1 ? "" : "s"} and their
            history were deleted, but Plaid rejected the revoke ({result.revokeError}). The link is
            still live upstream — remove it from your Plaid dashboard.
          </p>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="mt-3 rounded-full border border-line px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--paper)]"
          >
            Dismiss
          </button>
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Disconnect ${institution}`}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-[var(--panel)] p-6 shadow-[var(--elev-2)]">
            <h2 className="font-display text-2xl tracking-tight">Disconnect {institution}?</h2>

            <p className="mt-3 text-sm text-[var(--muted)]">
              This revokes the Plaid link and permanently deletes{" "}
              <b className="text-[var(--paper)]">
                {accountCount} account{accountCount === 1 ? "" : "s"}
              </b>{" "}
              along with every transaction, holding, split, note and tag that came with them. It
              cannot be undone.
            </p>
            <p className="mt-3 text-sm text-[var(--muted)]">
              To keep the history but stop counting it toward net worth, close this and use the
              hide toggle on each account instead.
            </p>

            <label className="mt-5 block text-xs uppercase tracking-wide text-[var(--muted)]">
              Type <span className="mono text-[var(--brass)]">{institution}</span> to confirm
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              className="mt-2 w-full rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm outline-none focus:border-[var(--brass-dim)]"
              placeholder={institution}
            />

            {error && <p className="mt-3 text-sm text-[var(--coral)]">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-full border border-line px-4 py-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--paper)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={!confirmed || pending}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--coral)] px-4 py-1.5 text-sm font-medium text-[var(--ink)] transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending && <Loader2 size={14} className="animate-spin" />}
                {pending ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
