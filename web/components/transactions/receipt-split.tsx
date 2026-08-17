"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Camera, Check, Loader2, Minus, Plus, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { scanReceipt } from "@/lib/actions-receipt";
import { allocateReceipt, assignAllEvenly, receiptTotal } from "@/lib/receipt/allocate";
import { ME, type ItemAssignment, type ParsedReceipt, type ReceiptItem } from "@/lib/receipt/types";

/**
 * Split a bill by item.
 *
 * The interaction is one gesture repeated: for each line, tap the people who ate
 * it. Tapping again removes them; the +/− beside a selected person handles "I
 * had two of the three buns". That single control covers shared plates and
 * uneven portions, which is why there's no mode switch — a shared plate is just
 * everyone at weight 1.
 *
 * Tax and tip are never shown as something to assign. They follow the food
 * automatically, prorated by what each person ate, because that's the answer
 * everyone actually wants and arguing about it at the table is the thing this
 * screen exists to end.
 */

export type Participant = { id: string; name: string };

const fmt = (n: number, currency: string | null) => formatCurrency(n, currency ?? undefined);

export function ReceiptSplit({
  transactionId,
  currency,
  participants,
  scanAvailable,
  receipt,
  assignments,
  onReceipt,
  onAssignments,
  disabled,
}: {
  transactionId: string;
  currency: string | null;
  participants: Participant[];
  scanAvailable: boolean;
  receipt: ParsedReceipt | null;
  assignments: Record<string, ItemAssignment>;
  onReceipt: (r: ParsedReceipt | null, a: Record<string, ItemAssignment>) => void;
  onAssignments: (a: Record<string, ItemAssignment>) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, startScan] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(file: File) {
    setError(null);
    startScan(async () => {
      const form = new FormData();
      form.set("transactionId", transactionId);
      form.set("file", file);
      const res = await scanReceipt(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Open with everyone on everything — one tap from the common case where a
      // table shares most of the food, and never a screen of empty rows.
      onReceipt(res.receipt, assignAllEvenly(res.receipt, participants.map((p) => p.id)));
    });
  }

  if (!receipt) {
    return (
      <div className="space-y-3">
        <div className="rounded-[var(--radius)] border border-dashed border-line px-4 py-6 text-center">
          <ScanLine size={22} className="mx-auto text-[var(--faint)]" />
          <p className="mt-2.5 text-sm">Split it by item</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-[var(--muted)]">
            {scanAvailable
              ? "Photograph the receipt and assign each line to whoever ate it. Tax and tip follow automatically."
              : "Receipt scanning needs macOS on-device text recognition. Add the lines by hand instead."}
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
              e.target.value = "";
            }}
          />

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {scanAvailable && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={disabled || scanning}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brass)] px-4 py-1.5 text-xs font-medium text-[var(--on-brass)] transition hover:brightness-105 disabled:opacity-40"
              >
                {scanning ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                {scanning ? "Reading…" : "Scan receipt"}
              </button>
            )}
            <button
              type="button"
              onClick={() => onReceipt(emptyReceipt(), {})}
              disabled={disabled || scanning}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--paper)] disabled:opacity-40"
            >
              <Plus size={13} /> Enter items by hand
            </button>
          </div>

          {scanAvailable && (
            <p className="mt-3 text-[11px] text-[var(--faint)]">
              The photo is read on this Mac and stays on it — nothing is uploaded.
            </p>
          )}
        </div>
        {error && <p className="text-xs text-[var(--coral)]">{error}</p>}
      </div>
    );
  }

  return (
    <ReceiptEditor
      receipt={receipt}
      assignments={assignments}
      participants={participants}
      currency={currency}
      disabled={disabled}
      onAssignments={onAssignments}
      onReceipt={onReceipt}
    />
  );
}

function emptyReceipt(): ParsedReceipt {
  return {
    items: [],
    subtotal: null,
    tax: null,
    tip: null,
    total: null,
    taxRatePct: null,
    discrepancy: null,
    unparsed: [],
  };
}

function ReceiptEditor({
  receipt,
  assignments,
  participants,
  currency,
  disabled,
  onAssignments,
  onReceipt,
}: {
  receipt: ParsedReceipt;
  assignments: Record<string, ItemAssignment>;
  participants: Participant[];
  currency: string | null;
  disabled?: boolean;
  onAssignments: (a: Record<string, ItemAssignment>) => void;
  onReceipt: (r: ParsedReceipt | null, a: Record<string, ItemAssignment>) => void;
}) {
  const ids = useMemo(() => participants.map((p) => p.id), [participants]);
  const split = useMemo(
    () => allocateReceipt({ receipt, assignments, participantIds: ids }),
    [receipt, assignments, ids],
  );
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? "—";

  function setWeight(itemId: string, personId: string, weight: number) {
    const next = { ...(assignments[itemId] ?? {}) };
    if (weight <= 0) delete next[personId];
    else next[personId] = weight;
    onAssignments({ ...assignments, [itemId]: next });
  }

  function everyone(itemId: string) {
    onAssignments({
      ...assignments,
      [itemId]: Object.fromEntries(ids.map((id) => [id, 1])),
    });
  }

  function editItem(itemId: string, patch: Partial<ReceiptItem>) {
    onReceipt(
      {
        ...receipt,
        items: receipt.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
        // The parse-time reconciliation no longer describes hand-edited lines.
        discrepancy: null,
      },
      assignments,
    );
  }

  function addItem() {
    const id = `it${receipt.items.length + 1}_${Math.random().toString(36).slice(2, 6)}`;
    onReceipt(
      {
        ...receipt,
        items: [
          ...receipt.items,
          { id, label: "", quantity: 1, unitPrice: null, total: 0, modifiers: [] },
        ],
      },
      { ...assignments, [id]: Object.fromEntries(ids.map((p) => [p, 1])) },
    );
  }

  function removeItem(itemId: string) {
    const next = { ...assignments };
    delete next[itemId];
    onReceipt({ ...receipt, items: receipt.items.filter((i) => i.id !== itemId) }, next);
  }

  const needsAssignment = split.unassignedItemIds.length;

  return (
    <div className="space-y-4">
      {/* What the scan read, and whether it adds up. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
        <span className="eyebrow">Receipt</span>
        <span className="mono">
          {receipt.items.length} {receipt.items.length === 1 ? "line" : "lines"}
        </span>
        {receipt.tax != null && (
          <span className="mono">
            tax {fmt(receipt.tax, currency)}
            {receipt.taxRatePct != null && ` · ${receipt.taxRatePct}%`}
          </span>
        )}
        {receipt.tip != null && <span className="mono">tip {fmt(receipt.tip, currency)}</span>}
        <span className="mono ml-auto text-[var(--paper)]">
          {fmt(receiptTotal(receipt), currency)}
        </span>
        <button
          type="button"
          onClick={() => onReceipt(null, {})}
          disabled={disabled}
          title="Start over"
          className="rounded p-1 text-[var(--faint)] transition hover:text-[var(--paper)]"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {receipt.discrepancy && (
        <p className="rounded-lg border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_10%,transparent)] px-3 py-2 text-xs text-[var(--brass)]">
          The lines add up to {fmt(receipt.discrepancy.itemsTotal, currency)} but the receipt says{" "}
          {fmt(receipt.discrepancy.subtotal, currency)} — off by{" "}
          {fmt(Math.abs(receipt.discrepancy.difference), currency)}. Fix a line before saving.
        </p>
      )}

      {/* The lines. */}
      <ul className="space-y-2">
        {receipt.items.map((item) => {
          const weights = assignments[item.id] ?? {};
          const on = ids.filter((id) => (weights[id] ?? 0) > 0);
          const orphan = on.length === 0;
          return (
            <li
              key={item.id}
              className={`rounded-[var(--radius)] border px-3 py-2.5 ${
                orphan ? "border-[var(--coral)]/50" : "border-line"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  value={item.label}
                  onChange={(e) => editItem(item.id, { label: e.target.value })}
                  placeholder="Item"
                  disabled={disabled}
                  className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-sm outline-none placeholder:text-[var(--faint)]"
                />
                {item.quantity > 1 && (
                  <span className="mono shrink-0 text-[11px] text-[var(--faint)]">
                    ×{item.quantity}
                  </span>
                )}
                <span className="shrink-0 text-xs text-[var(--faint)]">$</span>
                <input
                  value={item.total === 0 ? "" : String(item.total)}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={disabled}
                  onChange={(e) => editItem(item.id, { total: Number(e.target.value) || 0 })}
                  className="mono w-20 shrink-0 rounded-md border border-line bg-[var(--ink)] px-2 py-1 text-right text-sm outline-none focus:border-[var(--brass-dim)]"
                />
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.label || "item"}`}
                  disabled={disabled}
                  className="shrink-0 rounded p-1 text-[var(--faint)] transition hover:text-[var(--coral)]"
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {item.modifiers.length > 0 && (
                <p className="mt-0.5 truncate text-[11px] text-[var(--faint)]">
                  {item.modifiers
                    .map((m) => m.label + (m.price != null ? ` (${fmt(m.price, currency)})` : ""))
                    .join(" · ")}
                </p>
              )}

              {/* Who ate it. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {participants.map((p) => {
                  const w = weights[p.id] ?? 0;
                  const active = w > 0;
                  return (
                    <span
                      key={p.id}
                      className={`inline-flex items-center overflow-hidden rounded-full border text-[11px] transition ${
                        active
                          ? "border-[var(--brass)] bg-[color-mix(in_srgb,var(--brass)_16%,transparent)] text-[var(--paper)]"
                          : "border-line text-[var(--muted)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setWeight(item.id, p.id, active ? 0 : 1)}
                        aria-pressed={active}
                        disabled={disabled}
                        className="px-2.5 py-1 transition hover:text-[var(--paper)]"
                      >
                        {p.id === ME ? "You" : p.name}
                      </button>
                      {active && (
                        <span className="flex items-center border-l border-[var(--brass-dim)]/50">
                          <button
                            type="button"
                            onClick={() => setWeight(item.id, p.id, w - 1)}
                            aria-label={`Fewer for ${p.id === ME ? "you" : p.name}`}
                            disabled={disabled}
                            className="px-1.5 py-1 text-[var(--muted)] hover:text-[var(--paper)]"
                          >
                            <Minus size={9} />
                          </button>
                          <span className="mono min-w-3 text-center tabular-nums">{w}</span>
                          <button
                            type="button"
                            onClick={() => setWeight(item.id, p.id, w + 1)}
                            aria-label={`More for ${p.id === ME ? "you" : p.name}`}
                            disabled={disabled}
                            className="px-1.5 py-1 text-[var(--muted)] hover:text-[var(--paper)]"
                          >
                            <Plus size={9} />
                          </button>
                        </span>
                      )}
                    </span>
                  );
                })}
                <button
                  type="button"
                  onClick={() => everyone(item.id)}
                  disabled={disabled}
                  className="ml-auto rounded-full px-2 py-1 text-[11px] text-[var(--faint)] transition hover:text-[var(--brass)]"
                >
                  Everyone
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addItem}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--paper)]"
        >
          <Plus size={12} /> Add a line
        </button>
        {needsAssignment > 0 && (
          <p className="text-xs text-[var(--coral)]">
            {needsAssignment} {needsAssignment === 1 ? "line needs" : "lines need"} someone —{" "}
            {fmt(split.unassigned, currency)} unassigned.
          </p>
        )}
      </div>

      {/* What each person owes. */}
      <div className="rounded-[var(--radius)] border border-line">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="eyebrow">Each person owes</span>
          <span
            className={`mono text-xs ${
              split.unassigned > 0.004 ? "text-[var(--coral)]" : "text-[var(--jade)]"
            }`}
          >
            {fmt(split.allocated, currency)} of {fmt(receiptTotal(receipt), currency)}
            {split.unassigned <= 0.004 && <Check size={11} className="ml-1 inline" />}
          </span>
        </div>
        <ul className="divide-y divide-line/60">
          {split.people.map((p) => (
            <li key={p.participantId} className="flex items-baseline gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {p.participantId === ME ? "You" : nameOf(p.participantId)}
                {p.lines.length > 0 && (
                  <span className="ml-2 text-[11px] text-[var(--faint)]">
                    {p.lines
                      .map((l) => (l.of > 1 ? `${l.label} (${l.weight}/${l.of})` : l.label))
                      .join(", ")}
                  </span>
                )}
              </span>
              <span className="mono shrink-0 text-[11px] text-[var(--faint)]">
                {fmt(p.items, currency)} + {fmt(p.tax + p.tip, currency)} tax &amp; tip
              </span>
              <span className="mono w-20 shrink-0 text-right text-sm">
                {fmt(p.total, currency)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
