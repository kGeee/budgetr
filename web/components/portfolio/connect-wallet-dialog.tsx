"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { connectWallet, resyncWallet, removeWallet } from "@/lib/actions";
import type { WalletRow } from "@/lib/queries";

const CHAINS = [
  { id: "bitcoin", label: "Bitcoin", placeholder: "bc1… or 1…/3…" },
  { id: "ethereum", label: "Ethereum", placeholder: "0x…" },
  { id: "solana", label: "Solana", placeholder: "base58 address" },
] as const;

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] text-[var(--paper)] shadow-[var(--elev-3)]"
      >
        {children}
      </div>
    </div>
  );
}

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
      const { kept, droppedJunk, droppedDust, totalUsd } = res.sync;
      const dropped = droppedJunk + droppedDust;
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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Wallet size={14} /> Connect wallet
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
              <p className="text-[10px] text-[var(--faint)]">
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

/** Card listing connected wallets with re-sync + remove controls. */
export function WalletsCard({ wallets }: { wallets: WalletRow[] }) {
  if (wallets.length === 0) return null;
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--brass)]">
            <Wallet size={15} />
          </span>
          <span className="font-medium">Crypto wallets</span>
        </div>
        <span className="mono text-sm text-[var(--muted)]">
          {fmtUsd(wallets.reduce((s, w) => s + (w.lastValueUsd ?? 0), 0))}
        </span>
      </div>
      <ul>
        {wallets.map((w) => (
          <WalletRowItem key={w.id} wallet={w} />
        ))}
      </ul>
    </Card>
  );
}

function WalletRowItem({ wallet: w }: { wallet: WalletRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(w.lastError);

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
    : "never";

  return (
    <li className="flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--panel-2)]">
      <div className="min-w-0">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          <span className="truncate">{w.label}</span>
          <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
            {w.chain}
          </span>
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
          <span className="mono">{short}</span>
          {" · "}
          {w.lastTokenCount ?? 0} {w.lastTokenCount === 1 ? "token" : "tokens"}
          {" · synced "}
          {synced}
        </p>
        {error && <p className="mt-0.5 text-xs text-[var(--coral)]">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="mono text-sm text-[var(--paper)]">{fmtUsd(w.lastValueUsd ?? 0)}</span>
        <button
          onClick={sync}
          disabled={pending}
          aria-label={`Re-sync ${w.label}`}
          title="Re-sync balances"
          className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--brass)] disabled:opacity-40"
        >
          <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
        </button>
        <button
          onClick={remove}
          disabled={pending}
          aria-label={`Disconnect ${w.label}`}
          title="Disconnect wallet"
          className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--coral)] disabled:opacity-40"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
