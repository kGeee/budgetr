"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Filter, RefreshCw, RotateCcw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  connectWallet,
  resyncWallet,
  removeWallet,
  setWalletDustFloor,
  unhideWalletToken,
} from "@/lib/actions";
import type { HiddenWalletToken, WalletRow } from "@/lib/queries";

const CHAINS = [
  { id: "bitcoin", label: "Bitcoin", placeholder: "bc1… or 1…/3…" },
  { id: "ethereum", label: "Ethereum", placeholder: "0x…" },
  { id: "solana", label: "Solana", placeholder: "base58 address" },
] as const;

// The shared dialog: Escape, focus containment and focus return come with it.
const Modal = Dialog;

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** "Connect wallet" button + modal to import an on-chain address. */
export function ConnectWalletButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState<(typeof CHAINS)[number]["id"]>("bitcoin");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const active = CHAINS.find((c) => c.id === chain)!;

  function close() {
    setOpen(false);
    setChain("bitcoin");
    setAddress("");
    setLabel("");
    setError(null);
    setResult(null);
  }

  function submit() {
    if (!address.trim()) return;
    setError(null);
    setResult(null);
    start(async () => {
      const res = await connectWallet({ chain, address: address.trim(), label: label.trim() || null });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const { kept, droppedJunk, droppedDust, droppedHidden, totalUsd } = res.sync;
      const dropped = droppedJunk + droppedDust + droppedHidden;
      setResult(
        `Imported ${kept} ${kept === 1 ? "token" : "tokens"} (~${fmtUsd(totalUsd)})` +
          (dropped > 0 ? ` · filtered ${dropped} junk/dust` : ""),
      );
      setAddress("");
      setLabel("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Wallet size={15} /> Connect wallet
      </Button>

      {open && (
        <Modal onClose={close}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">Connect crypto wallet</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Read-only. We pull balances and keep only tokens with a real market value.
            </p>
          </div>

          <div className="space-y-3 p-5">
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--muted)]">Chain</span>
              <div className="flex gap-1 rounded-lg border border-line bg-[var(--panel-2)] p-1">
                {CHAINS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setChain(c.id)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                      chain === c.id
                        ? "bg-[var(--panel)] text-[var(--paper)]"
                        : "text-[var(--muted)] hover:text-[var(--paper)]"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-[var(--muted)]">Address</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={active.placeholder}
                className="mono h-9 w-full rounded-md border border-line bg-[var(--ink)] px-2.5 text-sm text-[var(--paper)] outline-none transition-colors placeholder:text-[var(--faint)] focus:border-[var(--brass-dim)]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-[var(--muted)]">Label (optional)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={`My ${active.label} wallet`}
                className="h-9 w-full rounded-md border border-line bg-[var(--ink)] px-2.5 text-sm text-[var(--paper)] outline-none transition-colors placeholder:text-[var(--faint)] focus:border-[var(--brass-dim)]"
              />
            </label>

            {chain === "ethereum" && !result && (
              <p className="text-xs text-[var(--muted)]">
                Native ETH imports without setup; ERC-20 tokens need an ALCHEMY_API_KEY.
              </p>
            )}
            {error && <p className="text-xs text-[var(--coral)]">{error}</p>}
            {result && <p className="text-xs text-[var(--jade)]">{result}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={close} className="text-xs text-[var(--muted)] hover:text-[var(--paper)]">
              {result ? "Done" : "Cancel"}
            </button>
            <Button size="sm" variant="primary" onClick={submit} disabled={!address.trim() || pending}>
              {pending ? "Importing…" : "Connect"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

const ROW_BUTTON =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors disabled:opacity-40";

/**
 * Connected wallets as rows of the Accounts page's Connections list — same
 * columns as a bank link (name and state, what it feeds, last sync, actions),
 * so a wallet reads as one more connection rather than its own card.
 *
 * `gridClassName` is the Connections column template, passed in by the page so
 * these rows and the server-rendered bank rows cannot drift apart.
 */
export function WalletConnectionRows({
  wallets,
  hiddenTokens = {},
  gridClassName,
}: {
  wallets: WalletRow[];
  /** Hand-hidden tokens per wallet id — the junk filter's undo list. */
  hiddenTokens?: Record<string, HiddenWalletToken[]>;
  gridClassName: string;
}) {
  return (
    <>
      {wallets.map((w) => (
        <WalletRowItem
          key={w.id}
          wallet={w}
          hidden={hiddenTokens[w.id] ?? []}
          gridClassName={gridClassName}
        />
      ))}
    </>
  );
}

function WalletRowItem({
  wallet: w,
  hidden,
  gridClassName,
}: {
  wallet: WalletRow;
  hidden: HiddenWalletToken[];
  gridClassName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(w.lastError);
  const [openFilters, setOpenFilters] = useState(false);

  function sync() {
    setError(null);
    start(async () => {
      const res = await resyncWallet(w.id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function remove() {
    if (!confirm(`Disconnect "${w.label}" and remove its imported tokens?`)) return;
    start(async () => {
      await removeWallet(w.id);
      router.refresh();
    });
  }

  const short = `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
  const synced = w.lastSyncedAt
    ? new Date(w.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "Never";
  const tokens = w.lastTokenCount ?? 0;
  const filtered = w.minValueUsd != null || hidden.length > 0;

  return (
    <li className="border-b border-line">
      <div className={`${gridClassName} min-h-[58px] items-center py-1.5`}>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span
            aria-hidden
            className={`h-[7px] w-[7px] shrink-0 rounded-full ${error ? "bg-[var(--coral)]" : "bg-[var(--jade)]"}`}
          />
          <span className="truncate font-medium">{w.label}</span>
          <span className={`text-xs ${error ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}>
            {error ? "Failing" : "Live"}
          </span>
          <span className="w-full pl-[17px] text-xs text-[var(--muted)]">
            Wallet · read-only <span className="capitalize">{w.chain}</span> address
          </span>
        </span>
        <span className="min-w-0 text-[13px] text-[var(--muted)]">
          <span className="mono text-xs">{short}</span>
          {" · "}
          {tokens} {tokens === 1 ? "token" : "tokens"}
          {" · "}
          {hidden.length} hidden
          <span className="mono block text-[var(--paper)]">{fmtUsd(w.lastValueUsd ?? 0)}</span>
        </span>
        <span className="mono text-xs text-[var(--muted)]">{synced}</span>
        <span className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpenFilters((v) => !v)}
            aria-expanded={openFilters}
            aria-label={`Manage tokens for ${w.label}`}
            title="Dust floor and hidden tokens"
            className={`${ROW_BUTTON} ${
              openFilters || filtered
                ? "border-[var(--brass-dim)] text-[var(--brass)]"
                : "border-[var(--line-strong)] text-[var(--paper)] hover:bg-[var(--panel-2)]"
            }`}
          >
            <Filter size={13} aria-hidden /> Manage tokens
          </button>
          <button
            type="button"
            onClick={sync}
            disabled={pending}
            aria-label={`Re-sync ${w.label}`}
            title="Re-sync balances"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--paper)] disabled:opacity-40"
          >
            <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={`Remove ${w.label}`}
            title="Disconnect wallet and remove its imported tokens"
            className={`${ROW_BUTTON} border-line text-[var(--coral)] hover:border-[color-mix(in_srgb,var(--coral)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--coral)_10%,transparent)]`}
          >
            Remove
          </button>
        </span>
      </div>

      {error && (
        <p role="alert" className="pb-3 pl-[17px] text-xs text-[var(--coral)]">
          {error}
        </p>
      )}
      {openFilters && <WalletFilterPanel wallet={w} hidden={hidden} onError={setError} />}
    </li>
  );
}

/**
 * Junk-filter controls for one wallet: the dust floor every imported token has to
 * clear, and the undo list for tokens hidden by hand from the portfolio. Both
 * changes re-sync the wallet so the holdings list matches immediately.
 */
function WalletFilterPanel({
  wallet: w,
  hidden,
  onError,
}: {
  wallet: WalletRow;
  hidden: HiddenWalletToken[];
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [floor, setFloor] = useState(w.minValueUsd != null ? String(w.minValueUsd) : "");
  const [pending, start] = useTransition();

  const parsed = floor.trim() === "" ? null : Number(floor);
  const floorValid = parsed === null || (Number.isFinite(parsed) && parsed >= 0);
  const floorChanged = (w.minValueUsd ?? null) !== (parsed && parsed > 0 ? parsed : null);

  function applyFloor() {
    if (!floorValid) return;
    onError(null);
    start(async () => {
      const res = await setWalletDustFloor(w.id, parsed);
      if (!res.ok) onError(res.error);
      router.refresh();
    });
  }

  function unhide(holdingId: string) {
    onError(null);
    start(async () => {
      const res = await unhideWalletToken(holdingId);
      if (!res.ok) onError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="mb-4 ml-[17px] grid max-w-3xl gap-x-10 gap-y-4 border-l border-[var(--line-strong)] pl-5 sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium">Dust floor</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Skip tokens worth less than this at sync. Blank uses the default of $1.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            placeholder="1"
            inputMode="decimal"
            aria-label={`Dust floor for ${w.label}`}
            className="mono h-8 w-24 rounded-md border border-line bg-[var(--ink)] px-2 text-sm text-[var(--paper)] outline-none transition-colors placeholder:text-[var(--faint)] focus:border-[var(--brass-dim)]"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={applyFloor}
            disabled={pending || !floorValid || !floorChanged}
          >
            {pending ? "Syncing…" : "Apply & re-sync"}
          </Button>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium">
          Hidden tokens{hidden.length > 0 && ` (${hidden.length})`}
        </p>
        {hidden.length === 0 ? (
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            None. Hide junk from a wallet holding on the Investments page — it stays hidden on re-sync.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {hidden.map((t) => (
              <li key={t.holdingId} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate">
                  <span className="text-[var(--paper)]">{t.label ?? "Unnamed token"}</span>
                  {t.contractAddress && (
                    <span className="mono ml-2 text-[11px] text-[var(--muted)]">
                      {t.contractAddress.slice(0, 6)}…{t.contractAddress.slice(-4)}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {t.hiddenValueUsd != null && (
                    <span className="mono text-[var(--muted)]">{fmtUsd(t.hiddenValueUsd)}</span>
                  )}
                  <button
                    onClick={() => unhide(t.holdingId)}
                    disabled={pending}
                    title="Un-hide and re-sync"
                    aria-label={`Un-hide ${t.label ?? "token"}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--paper)] disabled:opacity-40"
                  >
                    <RotateCcw size={12} aria-hidden /> Un-hide
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
