"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Camera, Check, Loader2, Minus, Plus, RotateCcw, ScanLine, Scale, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { scanReceipt } from "@/lib/actions-receipt";
import {
  allocateReceipt,
  assignAllEvenly,
  chargeGap,
  itemsTotal,
  receiptTotal,
  reconcileToCharge,
} from "@/lib/receipt/allocate";
import { acceptsMoneyDraft, formatMoneyDraft, parseMoneyDraft } from "@/lib/receipt/money-input";
import { ME, type ItemAssignment, type ParsedReceipt, type ReceiptItem } from "@/lib/receipt/types";

/**
 * Split a bill by item.
 *
 * Two things drive the design.
 *
 * **The charge is the truth, the receipt is evidence.** Tip is usually added
 * after the paper prints — you tap a percentage on the terminal — so the printed
 * total and the amount on your card routinely disagree. A $60 receipt against a
 * $66.13 charge is a 10% tip, not a bad scan, and the first version treating it
 * as an error to be fixed was the tool being wrong about the world. The gap now
 * lands in the tip field automatically, and tax and tip are editable.
 *
 * **Assigning should cost one tap per line.** People claim their own food, so
 * you pick whose turn it is once and then tap down the receipt. That beats
 * hunting for one person's chip on every row, which is what a chip-per-person
 * grid turns into with three people and ten lines.
 */

export type Participant = { id: string; name: string };

const fmt = (n: number, currency: string | null) => formatCurrency(n, currency ?? undefined);

/** Stable per-person colour so a line's initials are scannable at a glance. */
const PERSON_COLORS = [
  "var(--brass)",
  "var(--jade)",
  "var(--blue, #7fb2e0)",
  "#c98bd0",
  "#e0a26b",
  "#7fd0c4",
];

const colorFor = (index: number) => PERSON_COLORS[index % PERSON_COLORS.length];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ReceiptSplit({
  transactionId,
  currency,
  charged,
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
  /** What the card was actually charged. The number everything reconciles to. */
  charged: number;
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
  const [tipNote, setTipNote] = useState<number | null>(null);

  function pick(file: File) {
    setError(null);
    setTipNote(null);
    startScan(async () => {
      const form = new FormData();
      form.set("transactionId", transactionId);
      form.set("file", file);
      const res = await scanReceipt(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Close the gap to the charge before showing anything, so the first thing
      // you see already adds up. Nine times out of ten the difference is tip.
      const { receipt: reconciled, addedTip } = reconcileToCharge(res.receipt, charged);
      if (addedTip > 0) setTipNote(addedTip);
      onReceipt(reconciled, assignAllEvenly(reconciled, participants.map((p) => p.id)));
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
              ? "Photograph the receipt and tap who ate what. Tax and tip follow automatically."
              : "Receipt scanning needs macOS on-device text recognition. Add the lines by hand instead."}
          </p>

          {/* Inline display:none rather than a utility class — a native file
              input rendering its own "No file chosen" label in the middle of the
              empty state is exactly what a losing cascade looks like, and this
              cannot lose. Not rendered at all when there is nothing to scan. */}
          {scanAvailable && (
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pick(f);
                e.target.value = "";
              }}
            />
          )}

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
      charged={charged}
      disabled={disabled}
      tipNote={tipNote}
      onDismissTipNote={() => setTipNote(null)}
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
  charged,
  disabled,
  tipNote,
  onDismissTipNote,
  onAssignments,
  onReceipt,
}: {
  receipt: ParsedReceipt;
  assignments: Record<string, ItemAssignment>;
  participants: Participant[];
  currency: string | null;
  charged: number;
  disabled?: boolean;
  tipNote: number | null;
  onDismissTipNote: () => void;
  onAssignments: (a: Record<string, ItemAssignment>) => void;
  onReceipt: (r: ParsedReceipt | null, a: Record<string, ItemAssignment>) => void;
}) {
  const ids = useMemo(() => participants.map((p) => p.id), [participants]);

  /** Whose turn it is. Tapping a line puts this person on (or takes them off). */
  const [brush, setBrush] = useState<string>(ids[0] ?? ME);
  /** Lines showing their per-person portion steppers. Rare, so opt-in. */
  const [portionsFor, setPortionsFor] = useState<string | null>(null);

  const activeBrush = ids.includes(brush) ? brush : (ids[0] ?? ME);

  const split = useMemo(
    () => allocateReceipt({ receipt, assignments, participantIds: ids }),
    [receipt, assignments, ids],
  );

  const meta = useMemo(() => {
    const byId = new Map(participants.map((p, i) => [p.id, { ...p, color: colorFor(i) }]));
    return byId;
  }, [participants]);

  const items = itemsTotal(receipt);
  const total = receiptTotal(receipt);
  // Positive: the charge is ahead of the receipt (an untyped tip).
  // Negative: the receipt is ahead of the charge (a tip still settling).
  const gap = chargeGap(receipt, charged);
  const short = gap > 0.004;
  const pending = gap < -0.004;
  // The split reconciles against the RECEIPT, which is what people owe. A
  // pending tip is not an error, so it must not paint the summary red.
  const balanced = split.unassigned <= 0.004 && Math.abs(split.allocated - total) < 0.01;

  function setWeight(itemId: string, personId: string, weight: number) {
    const next = { ...(assignments[itemId] ?? {}) };
    if (weight <= 0) delete next[personId];
    else next[personId] = weight;
    onAssignments({ ...assignments, [itemId]: next });
  }

  /** Tapping a line toggles the current brush person on it. */
  function toggleBrush(itemId: string) {
    const on = (assignments[itemId] ?? {})[activeBrush] ?? 0;
    setWeight(itemId, activeBrush, on > 0 ? 0 : 1);
  }

  function everyoneOn(itemId: string) {
    onAssignments({ ...assignments, [itemId]: Object.fromEntries(ids.map((id) => [id, 1])) });
  }

  function patchReceipt(patch: Partial<ParsedReceipt>) {
    onReceipt({ ...receipt, ...patch }, assignments);
  }

  function editItem(itemId: string, patch: Partial<ReceiptItem>) {
    onReceipt(
      {
        ...receipt,
        items: receipt.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
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
      { ...assignments, [id]: { [activeBrush]: 1 } },
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
      {/* ── Who am I assigning? ─────────────────────────────────────────── */}
      <div className="rounded-[var(--radius)] border border-line px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">Tap lines to assign</p>
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

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {participants.map((p) => {
            const on = p.id === activeBrush;
            const color = meta.get(p.id)?.color ?? "var(--brass)";
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setBrush(p.id)}
                aria-pressed={on}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition"
                style={{
                  borderColor: on ? color : "var(--line)",
                  background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : "transparent",
                  color: on ? "var(--paper)" : "var(--muted)",
                }}
              >
                <span
                  className="mono grid h-4 w-4 place-items-center rounded-full text-[9px] font-semibold"
                  style={{ background: color, color: "var(--ink)" }}
                >
                  {initials(p.id === ME ? "You" : p.name)}
                </span>
                {p.id === ME ? "You" : p.name}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={() => onAssignments(assignAllEvenly(receipt, ids))}
            disabled={disabled}
            className="text-[var(--brass)] transition hover:text-[var(--paper)]"
          >
            Everyone on everything
          </button>
          <button
            type="button"
            onClick={() => onAssignments({})}
            disabled={disabled}
            className="text-[var(--muted)] transition hover:text-[var(--paper)]"
          >
            Clear
          </button>
          <span className="ml-auto text-[var(--faint)]">
            {receipt.items.length - needsAssignment}/{receipt.items.length} assigned
          </span>
        </div>
      </div>

      {tipNote != null && (
        <p className="flex items-start gap-2 rounded-lg border border-[var(--jade)]/40 bg-[color-mix(in_srgb,var(--jade)_10%,transparent)] px-3 py-2 text-xs text-[var(--paper)]">
          <Check size={13} className="mt-0.5 shrink-0 text-[var(--jade)]" />
          <span>
            The receipt was {fmt(tipNote, currency)} short of the{" "}
            {fmt(Math.abs(charged), currency)} charged, so{" "}
            <b>{fmt(tipNote, currency)} was added as tip</b>. Change it below if that&rsquo;s not
            right.
          </span>
          <button
            type="button"
            onClick={onDismissTipNote}
            className="ml-auto shrink-0 text-[var(--faint)] hover:text-[var(--paper)]"
          >
            ×
          </button>
        </p>
      )}

      {/* ── The lines ───────────────────────────────────────────────────── */}
      <ul className="space-y-1.5">
        {receipt.items.map((item) => {
          const weights = assignments[item.id] ?? {};
          const on = ids.filter((id) => (weights[id] ?? 0) > 0);
          const orphan = on.length === 0;
          const brushOn = (weights[activeBrush] ?? 0) > 0;
          const showPortions = portionsFor === item.id;

          return (
            <li
              key={item.id}
              className={`rounded-[var(--radius)] border transition-colors ${
                orphan
                  ? "border-[var(--coral)]/45"
                  : brushOn
                    ? "border-[var(--brass-dim)] bg-[var(--panel-2)]/40"
                    : "border-line"
              }`}
            >
              {/*
                Two rows, not one.
                
                Everything on a line — a name, who's on it, a price, and four
                controls — does not fit across a dialog column, and the name is
                what loses: it collapsed to a two-character box you couldn't read
                or type into. The name and its price get a row to themselves; the
                people and the controls get the row below, indented under the
                checkbox so the line still reads as one block.

                The row is the tap target for the brush, EXCEPT over the inputs
                and buttons inside it — otherwise the line name stops being
                editable, which is exactly what happened when the label itself
                was the button.
              */}
              <div
                className="px-3 py-2"
                onClick={(e) => {
                  if (disabled) return;
                  if ((e.target as HTMLElement).closest("input,button,textarea,select")) return;
                  toggleBrush(item.id);
                }}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleBrush(item.id)}
                    disabled={disabled}
                    aria-pressed={brushOn}
                    aria-label={`${brushOn ? "Remove" : "Add"} ${
                      activeBrush === ME ? "you" : meta.get(activeBrush)?.name ?? "person"
                    } ${brushOn ? "from" : "to"} ${item.label || "this line"}`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded"
                  >
                    <span
                      className="grid h-4 w-4 place-items-center rounded border transition-colors"
                      style={{
                        borderColor: brushOn
                          ? meta.get(activeBrush)?.color ?? "var(--brass)"
                          : "var(--line-strong)",
                        background: brushOn
                          ? meta.get(activeBrush)?.color ?? "var(--brass)"
                          : "transparent",
                      }}
                    >
                      {brushOn && <Check size={10} className="text-[var(--ink)]" />}
                    </span>
                  </button>

                  <input
                    value={item.label}
                    onChange={(e) => editItem(item.id, { label: e.target.value })}
                    placeholder="Untitled line"
                    disabled={disabled}
                    aria-label="Line name"
                    className="mono min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-[var(--brass-dim)]"
                  />
                  {item.quantity > 1 && (
                    <span className="mono shrink-0 text-[11px] text-[var(--faint)]">
                      ×{item.quantity}
                    </span>
                  )}
                  <MoneyInput
                    value={item.total === 0 ? null : item.total}
                    onChange={(v) => editItem(item.id, { total: v ?? 0 })}
                    disabled={disabled}
                    label={`Price of ${item.label || "line"}`}
                  />
                </div>

                <div className="mt-1.5 flex items-center gap-1.5 pl-8">
                  {/* Who's on this line. Each initial removes that person. */}
                  {on.length > 0 ? (
                    <span className="flex items-center -space-x-1">
                      {on.map((id) => {
                        const p = meta.get(id);
                        const w = weights[id] ?? 1;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setWeight(item.id, id, 0)}
                            disabled={disabled}
                            title={`${id === ME ? "You" : p?.name} — tap to remove`}
                            className="mono grid h-5 min-w-5 place-items-center rounded-full border border-[var(--panel)] px-1 text-[9px] font-semibold"
                            style={{ background: p?.color ?? "var(--muted)", color: "var(--ink)" }}
                          >
                            {initials(id === ME ? "You" : p?.name ?? "?")}
                            {w > 1 && <span className="ml-0.5">×{w}</span>}
                          </button>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--coral)]">nobody yet</span>
                  )}

                  <button
                    type="button"
                    onClick={() => everyoneOn(item.id)}
                    disabled={disabled}
                    className="ml-auto rounded-full border border-line px-2 py-0.5 text-[10px] text-[var(--muted)] transition hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
                  >
                    Everyone
                  </button>
                  <button
                    type="button"
                    onClick={() => setPortionsFor(showPortions ? null : item.id)}
                    disabled={disabled || on.length === 0}
                    title="Uneven portions"
                    aria-expanded={showPortions}
                    className="rounded p-1 text-[var(--faint)] transition hover:text-[var(--brass)] disabled:opacity-30"
                  >
                    <Scale size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={disabled}
                    aria-label={`Remove ${item.label || "line"}`}
                    className="rounded p-1 text-[var(--faint)] transition hover:text-[var(--coral)]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Portions, opt-in: "I had two of the three buns". Rare enough
                  that it stays behind the scales button rather than putting a
                  stepper on every person on every line. */}
              {showPortions && on.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
                  <span className="text-[11px] text-[var(--muted)]">Portions</span>
                  {on.map((id) => {
                    const w = weights[id] ?? 1;
                    const p = meta.get(id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[11px]"
                      >
                        <span className="text-[var(--muted)]">{id === ME ? "You" : p?.name}</span>
                        <button
                          type="button"
                          onClick={() => setWeight(item.id, id, w - 1)}
                          disabled={disabled}
                          aria-label={`Fewer for ${id === ME ? "you" : p?.name}`}
                          className="px-1 text-[var(--faint)] hover:text-[var(--paper)]"
                        >
                          <Minus size={9} />
                        </button>
                        <span className="mono min-w-3 text-center tabular-nums">{w}</span>
                        <button
                          type="button"
                          onClick={() => setWeight(item.id, id, w + 1)}
                          disabled={disabled}
                          aria-label={`More for ${id === ME ? "you" : p?.name}`}
                          className="px-1 text-[var(--faint)] hover:text-[var(--paper)]"
                        >
                          <Plus size={9} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {item.modifiers.length > 0 && (
                <p className="truncate px-3 pb-2 text-[11px] text-[var(--faint)]">
                  {item.modifiers
                    .map((m) => m.label + (m.price != null ? ` (${fmt(m.price, currency)})` : ""))
                    .join(" · ")}
                </p>
              )}
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
            {needsAssignment} {needsAssignment === 1 ? "line needs" : "lines need"} someone
          </p>
        )}
      </div>

      {/* ── Tax, tip, and the reconciliation ────────────────────────────── */}
      <div className="rounded-[var(--radius)] border border-line">
        <ul className="divide-y divide-line/60 text-sm">
          <li className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-[var(--muted)]">Items</span>
            <span className="mono">{fmt(items, currency)}</span>
          </li>
          <MoneyRow
            label="Tax"
            hint={receipt.taxRatePct != null ? `${receipt.taxRatePct}%` : undefined}
            value={receipt.tax}
            disabled={disabled}
            onChange={(v) => patchReceipt({ tax: v })}
          />
          <MoneyRow
            label="Tip"
            hint={
              items > 0 && (receipt.tip ?? 0) > 0
                ? `${Math.round(((receipt.tip ?? 0) / items) * 100)}% of items`
                : undefined
            }
            value={receipt.tip}
            disabled={disabled}
            onChange={(v) => patchReceipt({ tip: v })}
            quick={[0.15, 0.18, 0.2, 0.22].map((r) => ({
              label: `${Math.round(r * 100)}%`,
              value: Math.round(items * r * 100) / 100,
            }))}
          />
          <li className="flex items-center justify-between gap-3 px-3 py-2">
            <span>Receipt total</span>
            <span className="mono">{fmt(total, currency)}</span>
          </li>
          <li className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-[var(--muted)]">Charged</span>
            <span className="mono text-[var(--muted)]">{fmt(Math.abs(charged), currency)}</span>
          </li>
        </ul>

        {short && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
            <span className="text-xs text-[var(--coral)]">
              {fmt(gap, currency)} of the charge isn&rsquo;t on the receipt.
            </span>
            <button
              type="button"
              onClick={() => patchReceipt({ tip: Math.round(((receipt.tip ?? 0) + gap) * 100) / 100 })}
              disabled={disabled}
              className="rounded-full bg-[var(--brass)] px-2.5 py-1 text-[11px] font-medium text-[var(--on-brass)] transition hover:brightness-105"
            >
              Add as tip
            </button>
            <button
              type="button"
              onClick={() => patchReceipt({ tax: Math.round(((receipt.tax ?? 0) + gap) * 100) / 100 })}
              disabled={disabled}
              className="rounded-full border border-line px-2.5 py-1 text-[11px] text-[var(--muted)] transition hover:text-[var(--paper)]"
            >
              Add as tax
            </button>
          </div>
        )}

        {/* The receipt running ahead of the charge is the normal pending-tip
            case, not a mistake — the split follows the paper, and the bank
            catches up. Offered as information with an escape hatch, not an
            error with a demand. */}
        {pending && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
            <span className="text-xs text-[var(--muted)]">
              {fmt(Math.abs(gap), currency)} hasn&rsquo;t posted yet — a tip still settling.
              Splitting the {fmt(total, currency)} receipt.
            </span>
            <button
              type="button"
              onClick={() =>
                patchReceipt({
                  tip: Math.max(0, Math.round(((receipt.tip ?? 0) + gap) * 100) / 100),
                })
              }
              disabled={disabled}
              className="ml-auto rounded-full border border-line px-2.5 py-1 text-[11px] text-[var(--muted)] transition hover:text-[var(--paper)]"
            >
              Split {fmt(Math.abs(charged), currency)} instead
            </button>
          </div>
        )}
      </div>

      {/* ── What each person owes ───────────────────────────────────────── */}
      <div className="rounded-[var(--radius)] border border-line">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="eyebrow">Each person owes</span>
          <span
            className={`mono inline-flex items-center gap-1 text-xs ${
              balanced && split.unassigned <= 0.004
                ? "text-[var(--jade)]"
                : "text-[var(--coral)]"
            }`}
          >
            {fmt(split.allocated, currency)}
            {balanced && split.unassigned <= 0.004 && <Check size={11} />}
          </span>
        </div>
        <ul className="divide-y divide-line/60">
          {split.people.map((p) => {
            const person = meta.get(p.participantId);
            return (
              <li key={p.participantId} className="flex items-baseline gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.participantId === ME ? "You" : person?.name ?? "—"}
                  {p.lines.length > 0 && (
                    <span className="ml-2 text-[11px] text-[var(--faint)]">
                      {p.lines
                        .map((l) => (l.of > 1 ? `${l.label} (${l.weight}/${l.of})` : l.label))
                        .join(", ")}
                    </span>
                  )}
                </span>
                <span className="mono shrink-0 text-[11px] text-[var(--faint)]">
                  {fmt(p.items, currency)} + {fmt(p.tax + p.tip, currency)}
                </span>
                <span className="mono w-20 shrink-0 text-right text-sm">
                  {fmt(p.total, currency)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * An editable money line in the totals block.
 *
 * Two rows on purpose: label and amount on top so the column of figures stays
 * aligned with Items / Receipt total / Charged above and below it, presets
 * underneath. Squeezing four tip buttons onto the amount row pushed the input to
 * a line of its own and broke that alignment.
 */
function MoneyRow({
  label,
  hint,
  value,
  disabled,
  onChange,
  quick,
}: {
  label: string;
  hint?: string;
  value: number | null;
  disabled?: boolean;
  onChange: (v: number | null) => void;
  quick?: { label: string; value: number }[];
}) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[var(--muted)]">{label}</span>
        {hint && <span className="mono text-[11px] text-[var(--faint)]">{hint}</span>}
        <span className="ml-auto flex items-center gap-1">
          <span className="text-xs text-[var(--faint)]">$</span>
          <MoneyInput value={value} onChange={onChange} disabled={disabled} label={label} />
        </span>
      </div>

      {quick && quick.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-0.5">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => onChange(q.value)}
              disabled={disabled}
              title={`${q.label} of items`}
              className="rounded-full border border-line px-2 py-0.5 text-[10px] text-[var(--muted)] transition hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}


/**
 * A money field you can actually type a decimal into.
 *
 * Holds what was typed, not what it parsed to. Storing `Number(text)` and
 * rendering `String(value)` looks correct until someone types "6." — that stores
 * 6, re-renders "6", and swallows the point, so the field silently refuses cents.
 * The draft is released on blur so a value set from elsewhere (a scan, a tip
 * preset) shows up cleanly.
 */
function MoneyInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      value={draft ?? formatMoneyDraft(value)}
      inputMode="decimal"
      placeholder="0.00"
      disabled={disabled}
      aria-label={label}
      onChange={(e) => {
        const raw = e.target.value;
        if (!acceptsMoneyDraft(raw)) return;
        setDraft(raw);
        onChange(parseMoneyDraft(raw));
      }}
      onBlur={() => setDraft(null)}
      className="mono w-[5.5rem] shrink-0 rounded-md border border-line px-2 py-1 text-right text-sm outline-none focus:border-[var(--brass-dim)]"
    />
  );
}
