"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { computeSplit, type SplitMode, type SplitParticipant } from "@/lib/split-math";
import {
  createPerson,
  loadPeopleBalances,
  loadSharedExpense,
  removeSharedExpense,
  saveSharedExpense,
} from "@/lib/actions-sharing";
import type { PersonBalance } from "@/lib/sharing";

/**
 * The bill splitter — "I paid, these people owe me".
 *
 * Splits are previewed live against the same allocator the server uses
 * (lib/split-math.ts), so what you see is exactly what gets written; the server
 * recomputes rather than trusting these numbers.
 */

type Txn = {
  id: string;
  displayName: string;
  amount: number;
  currency: string | null;
  date: string;
  categoryId: string | null;
  splitCount: number;
};

const MODES: { id: SplitMode; label: string }[] = [
  { id: "even", label: "Evenly" },
  { id: "amounts", label: "Amounts" },
  { id: "percent", label: "Percent" },
];

/** Key for the "me" row in the values map — no person id to hang it on. */
const ME = "__me__";

/** formatCurrency wants an optional code; transactions carry a nullable one. */
const fmt = (n: number, currency: string | null) => formatCurrency(n, currency ?? undefined);

export function SplitBillButton({
  transaction,
  categories,
}: {
  transaction: Txn;
  categories: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [alreadyShared, setAlreadyShared] = useState(false);

  // Cheap existence check so the button can label itself correctly without
  // opening; the modal loads the full record.
  useEffect(() => {
    let live = true;
    loadSharedExpense(transaction.id).then((e) => live && setAlreadyShared(Boolean(e)));
    return () => {
      live = false;
    };
  }, [transaction.id]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
      >
        <Users size={13} /> {alreadyShared ? "Edit bill split" : "Split with people"}
      </button>
      {open && (
        <SplitModal
          transaction={transaction}
          categories={categories}
          onClose={() => setOpen(false)}
          onChanged={() => setAlreadyShared(true)}
          onRemoved={() => setAlreadyShared(false)}
        />
      )}
    </>
  );
}

function SplitModal({
  transaction,
  categories,
  onClose,
  onChanged,
  onRemoved,
}: {
  transaction: Txn;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const router = useRouter();
  const [people, setPeople] = useState<PersonBalance[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [includeMe, setIncludeMe] = useState(true);
  const [mode, setMode] = useState<SplitMode>("even");
  const [values, setValues] = useState<Record<string, string>>({});
  const [myCategoryId, setMyCategoryId] = useState<string | null>(transaction.categoryId);
  const [note, setNote] = useState("");
  const [existing, setExisting] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total = transaction.amount;
  const currency = transaction.currency;

  // Load the roster and any split already on this transaction.
  useEffect(() => {
    let live = true;
    Promise.all([loadPeopleBalances(), loadSharedExpense(transaction.id)]).then(([ppl, ex]) => {
      if (!live) return;
      setPeople(ppl);
      if (ex) {
        setExisting(true);
        setSelected(ex.shares.map((s) => s.personId));
        setIncludeMe(Math.abs(ex.myShare) >= 0.005);
        setNote(ex.note ?? "");
        // Re-open in Amounts: the stored figures are authoritative, and we can't
        // know whether they originally came from an even or percentage split.
        setMode("amounts");
        setValues(
          Object.fromEntries(ex.shares.map((s) => [s.personId, Math.abs(s.amount).toFixed(2)])),
        );
      }
    });
    return () => {
      live = false;
    };
  }, [transaction.id]);

  const roster = useMemo(
    () => (people ?? []).filter((p) => !p.archived || selected.includes(p.id)),
    [people, selected],
  );

  const participants: SplitParticipant[] = useMemo(() => {
    const rows: SplitParticipant[] = selected.map((personId) => ({
      personId,
      value: Number(values[personId] ?? ""),
    }));
    if (includeMe) rows.unshift({ personId: null, value: Number(values[ME] ?? "") });
    return rows;
  }, [selected, values, includeMe]);

  const preview = useMemo(
    () => computeSplit(total, mode, participants),
    [total, mode, participants],
  );

  /**
   * Switching modes seeds the new inputs from an even split, so Amounts and
   * Percent open on something sensible instead of empty boxes.
   */
  function changeMode(next: SplitMode) {
    setMode(next);
    setError(null);
    if (next === "even") return;
    const even = computeSplit(total, "even", participants);
    if (!even.ok) return;
    const seeded: Record<string, string> = {};
    for (const s of even.split.shares) {
      seeded[s.personId] =
        next === "percent"
          ? ((Math.abs(s.amount) / Math.abs(total)) * 100).toFixed(1)
          : Math.abs(s.amount).toFixed(2);
    }
    if (includeMe) {
      seeded[ME] =
        next === "percent"
          ? ((Math.abs(even.split.myShare) / Math.abs(total)) * 100).toFixed(1)
          : Math.abs(even.split.myShare).toFixed(2);
    }
    setValues(seeded);
  }

  function toggle(personId: string) {
    setError(null);
    setSelected((prev) =>
      prev.includes(personId) ? prev.filter((p) => p !== personId) : [...prev, personId],
    );
  }

  function addPerson() {
    const name = newName.trim();
    if (!name) return;
    start(async () => {
      const res = await createPerson({ name });
      if (!res.ok || !res.id) {
        setError(res.error ?? "Could not add them.");
        return;
      }
      setNewName("");
      setError(null);
      setPeople(await loadPeopleBalances());
      setSelected((prev) => [...prev, res.id!]);
    });
  }

  function save() {
    if (!preview.ok) {
      setError(preview.error);
      return;
    }
    start(async () => {
      const res = await saveSharedExpense({
        txnId: transaction.id,
        mode,
        participants,
        myCategoryId,
        note,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save the split.");
        return;
      }
      onChanged();
      router.refresh();
      onClose();
    });
  }

  function remove() {
    start(async () => {
      await removeSharedExpense(transaction.id);
      onRemoved();
      router.refresh();
      onClose();
    });
  }

  const owed = preview.ok
    ? Math.round(preview.split.shares.reduce((a, s) => a + s.amount, 0) * 100) / 100
    : 0;

  // Only warn about clobbering *plain category* splits — our own split rows are
  // about to be rewritten anyway, which is expected.
  const clobbers = transaction.splitCount > 0 && !existing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Split this bill"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-[var(--radius)] border border-line bg-[var(--panel)] text-[var(--paper)] shadow-[var(--elev-3)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="eyebrow">Split this bill</p>
            <p className="mt-1 truncate text-sm">{transaction.displayName}</p>
            <p className="mono mt-0.5 text-xs text-[var(--muted)]">
              {fmt(Math.abs(total), currency)} · {transaction.date}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--faint)] hover:text-[var(--paper)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {clobbers && (
            <p className="rounded-lg border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_10%,transparent)] px-3 py-2 text-xs text-[var(--brass)]">
              This transaction already has category splits. Saving a bill split replaces them.
            </p>
          )}

          {/* People */}
          <div>
            <p className="eyebrow mb-2">Split with</p>
            {people === null ? (
              <p className="text-xs text-[var(--muted)]">Loading…</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {roster.map((p) => {
                  const on = selected.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        on
                          ? "border-[var(--brass)] bg-[color-mix(in_srgb,var(--brass)_16%,transparent)] text-[var(--paper)]"
                          : "border-line text-[var(--muted)] hover:text-[var(--paper)]"
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPerson())}
                placeholder="Add someone…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
              />
              <button
                onClick={addPerson}
                disabled={pending || !newName.trim()}
                className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--paper)] disabled:opacity-40"
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </div>

          {/* Mode */}
          <div>
            <p className="eyebrow mb-2">Split</p>
            <div className="flex gap-1 rounded-full border border-line p-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => changeMode(m.id)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-xs transition ${
                    mode === m.id
                      ? "bg-[var(--panel-2)] text-[var(--paper)]"
                      : "text-[var(--muted)] hover:text-[var(--paper)]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <label className="mt-2.5 flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={includeMe}
                onChange={(e) => {
                  setIncludeMe(e.target.checked);
                  setError(null);
                }}
                className="accent-[var(--brass)]"
              />
              Include my own share
            </label>
          </div>

          {/* Per-person breakdown */}
          {selected.length > 0 && (
            <div className="space-y-1.5">
              {includeMe && (
                <SplitRow
                  label="You"
                  mode={mode}
                  currency={currency}
                  amount={preview.ok ? preview.split.myShare : 0}
                  // In Amounts mode your share is whatever's left — not an input.
                  value={mode === "percent" ? (values[ME] ?? "") : undefined}
                  onChange={(v) => setValues((s) => ({ ...s, [ME]: v }))}
                  disabled={pending}
                />
              )}
              {selected.map((personId) => {
                const person = roster.find((p) => p.id === personId);
                const share = preview.ok
                  ? preview.split.shares.find((s) => s.personId === personId)
                  : undefined;
                return (
                  <SplitRow
                    key={personId}
                    label={person?.name ?? "—"}
                    mode={mode}
                    currency={currency}
                    amount={share?.amount ?? 0}
                    value={mode === "even" ? undefined : (values[personId] ?? "")}
                    onChange={(v) => setValues((s) => ({ ...s, [personId]: v }))}
                    onRemove={() => toggle(personId)}
                    disabled={pending}
                  />
                );
              })}
            </div>
          )}

          {/* Where your own share reports */}
          {includeMe && (
            <div>
              <p className="eyebrow mb-2">Your share counts as</p>
              <select
                value={myCategoryId ?? ""}
                onChange={(e) => setMyCategoryId(e.target.value || null)}
                disabled={pending}
                className="w-full rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <p className="eyebrow mb-2">Note</p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Dinner at Otto's…"
              className="w-full rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
            />
          </div>

          {(error || (!preview.ok && selected.length > 0)) && (
            <p className="text-xs text-[var(--coral)]">
              {error ?? (!preview.ok ? preview.error : null)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Owed to you</p>
            <p className="mono mt-0.5 text-sm text-[var(--jade)]">
              {fmt(Math.abs(owed), currency)}
            </p>
          </div>
          {existing && (
            <button
              onClick={remove}
              disabled={pending}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--coral)] disabled:opacity-40"
            >
              Remove split
            </button>
          )}
          <button
            onClick={save}
            disabled={pending || !preview.ok}
            className="rounded-full bg-[var(--brass)] px-4 py-1.5 text-xs font-medium text-[var(--on-brass)] transition hover:brightness-105 disabled:opacity-40"
          >
            Save split
          </button>
        </div>
      </div>
    </div>
  );
}

/** One participant line: name, their computed amount, and (per mode) an input. */
function SplitRow({
  label,
  mode,
  currency,
  amount,
  value,
  onChange,
  onRemove,
  disabled,
}: {
  label: string;
  mode: SplitMode;
  currency: string | null;
  amount: number;
  value?: string;
  onChange?: (v: string) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {value !== undefined && onChange && (
        <div className="flex items-center gap-1">
          {mode === "amounts" && <span className="text-xs text-[var(--faint)]">$</span>}
          <input
            value={value}
            inputMode="decimal"
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="w-20 rounded-md border border-line bg-[var(--ink)] px-2 py-1 text-right text-sm outline-none focus:border-[var(--brass-dim)]"
          />
          {mode === "percent" && <span className="text-xs text-[var(--faint)]">%</span>}
        </div>
      )}
      <span className="mono w-24 shrink-0 text-right text-sm text-[var(--muted)]">
        {fmt(Math.abs(amount), currency)}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          disabled={disabled}
          className="rounded-md p-1 text-[var(--faint)] hover:text-[var(--coral)]"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
