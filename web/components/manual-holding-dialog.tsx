"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addManualHolding,
  clearHoldingCostBasisOverride,
  deleteManualHolding,
  setHoldingCostBasisOverride,
  updateManualHolding,
} from "@/lib/actions";

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] shadow-[var(--elev-3)]">
        {children}
      </div>
    </div>
  );
}

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** "Add holding" button + modal for off-Plaid assets (crypto, fixed-value). */
export function AddManualHoldingButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"tickered" | "fixed">("tickered");
  const [type, setType] = useState("crypto");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setMode("tickered");
    setType("crypto");
    setName("");
    setSymbol("");
    setQuantity("");
    setCost("");
    setValue("");
  }

  const valid =
    mode === "tickered" ? symbol.trim() !== "" && num(quantity) !== null : name.trim() !== "" && num(value) !== null;

  function submit() {
    if (!valid) return;
    start(async () => {
      if (mode === "tickered") {
        const sym = symbol.trim().toUpperCase();
        await addManualHolding({
          name: name.trim() || sym,
          symbol: sym,
          type,
          quantity: num(quantity),
          costBasis: num(cost),
        });
      } else {
        await addManualHolding({
          name: name.trim(),
          type: type === "crypto" ? "cash" : type,
          manualValue: num(value),
        });
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add holding
      </Button>

      {open && (
        <Modal onClose={close}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">Add off-account holding</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Crypto, assets at un-linkable institutions, or fixed-value items.
            </p>
          </div>

          <div className="space-y-3 p-5">
            {/* Mode toggle */}
            <div className="flex gap-1 rounded-lg border border-line bg-[var(--panel-2)] p-1">
              {(["tickered", "fixed"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                    mode === m
                      ? "bg-[var(--panel)] text-[var(--paper)]"
                      : "text-[var(--muted)] hover:text-[var(--paper)]"
                  }`}
                >
                  {m === "tickered" ? "By symbol" : "Fixed value"}
                </button>
              ))}
            </div>

            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-9 w-full rounded-md border border-line bg-[var(--ink)] px-2 text-sm outline-none focus:border-[var(--brass-dim)]"
              >
                {(mode === "tickered" ? ["crypto", "stock", "other"] : ["cash", "other"]).map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </Field>

            {mode === "tickered" ? (
              <>
                <Field label="Market symbol" hint="e.g. BTC-USD, ETH-USD, or a stock ticker">
                  <Input value={symbol} onChange={setSymbol} placeholder="BTC-USD" mono />
                </Field>
                <Field label="Name (optional)">
                  <Input value={name} onChange={setName} placeholder="Bitcoin" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Quantity">
                    <Input value={quantity} onChange={setQuantity} placeholder="0.5" mono />
                  </Field>
                  <Field label="Cost basis (opt)">
                    <Input value={cost} onChange={setCost} placeholder="14000" mono />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field label="Name">
                  <Input value={name} onChange={setName} placeholder="Gold bar" />
                </Field>
                <Field label="Current value">
                  <Input value={value} onChange={setValue} placeholder="8000" mono />
                </Field>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={close} className="text-xs text-[var(--muted)] hover:text-[var(--paper)]">
              Cancel
            </button>
            <Button size="sm" variant="primary" onClick={submit} disabled={!valid || pending}>
              Add
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Pencil button + modal to edit a manual holding's quantity / value / name. */
export function EditManualHoldingButton({
  id,
  name: initialName,
  isTickered,
  quantity: q0,
  costBasis: c0,
  value: v0,
}: {
  id: string;
  name: string;
  isTickered: boolean;
  quantity: number | null;
  costBasis: number | null;
  value: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [quantity, setQuantity] = useState(q0 != null ? String(q0) : "");
  const [cost, setCost] = useState(c0 != null ? String(c0) : "");
  const [value, setValue] = useState(v0 != null ? String(v0) : "");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      await updateManualHolding(
        id,
        isTickered
          ? { name: name.trim() || initialName, quantity: num(quantity), costBasis: num(cost) }
          : { name: name.trim() || initialName, manualValue: num(value) },
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Edit ${initialName}`}
        title="Edit holding"
        className="rounded-md p-1 text-[var(--faint)] opacity-0 transition hover:text-[var(--brass)] group-hover:opacity-100"
      >
        <Pencil size={13} />
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">Edit {initialName}</p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Name">
              <Input value={name} onChange={setName} />
            </Field>
            {isTickered ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity">
                  <Input value={quantity} onChange={setQuantity} mono />
                </Field>
                <Field label="Cost basis (opt)">
                  <Input value={cost} onChange={setCost} mono />
                </Field>
              </div>
            ) : (
              <Field label="Current value">
                <Input value={value} onChange={setValue} mono />
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-[var(--muted)] hover:text-[var(--paper)]"
            >
              Cancel
            </button>
            <Button size="sm" variant="primary" onClick={save} disabled={pending}>
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Trash button to remove a manual holding. */
export function DeleteManualHoldingButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function remove() {
    if (!confirm(`Remove "${name}" from your holdings?`)) return;
    start(async () => {
      await deleteManualHolding(id);
      router.refresh();
    });
  }

  return (
    <button
      onClick={remove}
      disabled={pending}
      aria-label={`Remove ${name}`}
      title="Remove holding"
      className="rounded-md p-1 text-[var(--faint)] opacity-0 transition hover:text-[var(--coral)] group-hover:opacity-100 disabled:opacity-40"
    >
      <Trash2 size={13} />
    </button>
  );
}

/**
 * Cost-basis corrector for a *Plaid* holding. Lets the user override the
 * brokerage-reported basis (broken after a transfer/merger) by entering either a
 * total dollar basis or an average cost/share, plus an optional as-of date. The
 * override lives in its own table so syncs don't wipe it; "Reset" clears it.
 */
export function EditCostBasisButton({
  holdingId,
  name,
  quantity,
  plaidCostBasis,
  overrideTotal,
  overrideUnit,
  overrideAsOf,
  hasOverride,
}: {
  holdingId: string;
  name: string;
  quantity: number | null;
  plaidCostBasis: number | null;
  overrideTotal: number | null;
  overrideUnit: number | null;
  overrideAsOf: string | null;
  hasOverride: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"total" | "unit">(overrideUnit != null ? "unit" : "total");
  const [total, setTotal] = useState(overrideTotal != null ? String(overrideTotal) : "");
  const [unit, setUnit] = useState(overrideUnit != null ? String(overrideUnit) : "");
  const [asOf, setAsOf] = useState(overrideAsOf ?? "");
  const [pending, start] = useTransition();

  // Live preview of the derived figure (total ↔ avg/share) using current qty.
  const qty = quantity ?? null;
  const derived =
    mode === "unit"
      ? qty != null && num(unit) != null
        ? `≈ ${fmtUsd(num(unit)! * qty)} total`
        : null
      : qty != null && qty !== 0 && num(total) != null
        ? `≈ ${fmtUsd(num(total)! / qty)} / share`
        : null;

  function save() {
    start(async () => {
      await setHoldingCostBasisOverride(
        holdingId,
        mode === "unit"
          ? { unitCost: num(unit), asOfDate: asOf || null }
          : { totalCost: num(total), asOfDate: asOf || null },
      );
      setOpen(false);
      router.refresh();
    });
  }

  function reset() {
    start(async () => {
      await clearHoldingCostBasisOverride(holdingId);
      setOpen(false);
      router.refresh();
    });
  }

  const canSave = mode === "unit" ? num(unit) != null : num(total) != null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Edit cost basis for ${name}`}
        title="Correct cost basis"
        className="rounded-md p-1 text-[var(--faint)] opacity-0 transition hover:text-[var(--brass)] group-hover:opacity-100"
      >
        <SlidersHorizontal size={13} />
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">Correct cost basis</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {name} · brokerage reports{" "}
              <span className="mono text-[var(--paper)]">
                {plaidCostBasis != null ? fmtUsd(plaidCostBasis) : "no basis"}
              </span>
            </p>
          </div>

          <div className="space-y-3 p-5">
            {/* Total vs per-share toggle */}
            <div className="flex gap-1 rounded-lg border border-line bg-[var(--panel-2)] p-1">
              {(["total", "unit"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                    mode === m
                      ? "bg-[var(--panel)] text-[var(--paper)]"
                      : "text-[var(--muted)] hover:text-[var(--paper)]"
                  }`}
                >
                  {m === "total" ? "Total cost" : "Avg / share"}
                </button>
              ))}
            </div>

            {mode === "total" ? (
              <Field label="Total cost basis" hint="What you paid for the whole position">
                <Input value={total} onChange={setTotal} placeholder="12400" mono />
              </Field>
            ) : (
              <Field label="Average cost / share" hint={qty != null ? `× ${qty.toLocaleString()} shares` : undefined}>
                <Input value={unit} onChange={setUnit} placeholder="124.00" mono />
              </Field>
            )}

            <Field label="As-of date (optional)" hint="e.g. your Schwab transfer date">
              <Input value={asOf} onChange={setAsOf} placeholder="2023-09-05" mono />
            </Field>

            {derived && <p className="mono text-xs text-[var(--brass)]">{derived}</p>}
          </div>

          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            {hasOverride ? (
              <button
                onClick={reset}
                disabled={pending}
                className="text-xs text-[var(--coral)] transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                Reset to brokerage
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-[var(--muted)] hover:text-[var(--paper)]"
              >
                Cancel
              </button>
              <Button size="sm" variant="primary" onClick={save} disabled={!canSave || pending}>
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-[var(--faint)]">{hint}</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`h-9 w-full rounded-md border border-line bg-[var(--ink)] px-2.5 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--brass-dim)] ${
        mono ? "mono" : ""
      }`}
    />
  );
}
