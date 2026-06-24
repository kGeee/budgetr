"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Repeat, X } from "lucide-react";
import { CategoryIcon } from "@/components/category-pill";
import {
  addTagToTransaction,
  applyCategoryToVendor,
  createTagRuleFromTransaction,
  getVendorReclassCount,
  removeTagFromTransaction,
  setReviewed,
  setTransactionCategory,
  setTransactionNotes,
} from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type { CategoryRow, TransactionRow } from "@/lib/queries";

export function TransactionDetail({
  transaction,
  categories,
  onClose,
}: {
  transaction: TransactionRow | null;
  categories: CategoryRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const t = transaction;

  // After changing a category, offer to apply it to other txns from this vendor.
  const [catOffer, setCatOffer] = useState<{
    categoryId: string;
    categoryName: string;
    count: number;
    vendorName: string;
  } | null>(null);
  // Reset the offer when a different transaction opens (adjust-state-on-prop-change).
  const [offerTxnId, setOfferTxnId] = useState(t?.id);
  if (t?.id !== offerTxnId) {
    setOfferTxnId(t?.id);
    setCatOffer(null);
  }

  // Close on Escape.
  useEffect(() => {
    if (!t) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t, onClose]);

  const open = !!t;
  const income = !!t && t.amount < 0;

  function act(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  function changeCategory(categoryId: string | null) {
    if (!t) return;
    start(async () => {
      await setTransactionCategory(t.id, categoryId);
      if (categoryId) {
        const match = await getVendorReclassCount(t.id, categoryId);
        setCatOffer(
          match
            ? {
                categoryId,
                categoryName:
                  categories.find((c) => c.id === categoryId)?.name ?? "this category",
                count: match.count,
                vendorName: match.vendorName,
              }
            : null,
        );
      } else {
        setCatOffer(null);
      }
      router.refresh();
    });
  }

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Transaction detail"
        className={`fixed right-0 top-0 z-40 flex h-dvh w-full max-w-[400px] flex-col border-l border-line bg-[var(--panel)] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)] transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        } ${pending ? "opacity-90" : ""}`}
      >
        {t && (
          <>
            <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <p className="eyebrow">{income ? "Income" : "Transaction"}</p>
                <p className="mt-1 truncate font-display text-lg">{t.displayName}</p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
              >
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {/* Amount */}
              <div>
                <p
                  className={`font-display text-4xl tabular ${income ? "text-[var(--jade)]" : "text-[var(--paper)]"}`}
                >
                  {income ? "+" : "−"}
                  {formatCurrency(Math.abs(t.amount), t.currency ?? "USD")}
                </p>
                <p className="mt-1.5 text-sm text-[var(--muted)]">
                  {t.date} · {t.accountName}
                  {t.pending && <span className="ml-2 text-[var(--brass)]">pending</span>}
                </p>
              </div>

              {/* Category */}
              <Field label="Category">
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--brass)]">
                      <CategoryIcon icon={t.categoryIcon} size={15} />
                    </span>
                    <select
                      value={t.categoryId ?? ""}
                      disabled={pending}
                      onChange={(e) => changeCategory(e.target.value || null)}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm outline-none focus:border-[var(--brass-dim)]"
                    >
                      <option value="">Auto (from Plaid)</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {catOffer && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_8%,transparent)] px-3 py-2 text-xs">
                      <span className="min-w-0 text-[var(--muted)]">
                        Apply{" "}
                        <span className="font-medium text-[var(--paper)]">
                          {catOffer.categoryName}
                        </span>{" "}
                        to {catOffer.count} other{" "}
                        {catOffer.count === 1 ? "transaction" : "transactions"} from{" "}
                        <span className="font-medium text-[var(--paper)]">
                          {catOffer.vendorName}
                        </span>
                        ?
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          disabled={pending}
                          onClick={() => {
                            const o = catOffer;
                            setCatOffer(null);
                            act(() => applyCategoryToVendor(t.id, o.categoryId));
                          }}
                          className="rounded-full bg-[var(--brass)] px-2.5 py-1 font-medium text-[#1a1505] hover:brightness-105"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => setCatOffer(null)}
                          aria-label="Dismiss"
                          className="rounded-md p-1 text-[var(--faint)] hover:text-[var(--paper)]"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </Field>

              {/* Recurring */}
              {t.recurring && (
                <Field label="Recurring">
                  <a
                    href="/recurring"
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brass-dim)] px-2.5 py-1 text-xs text-[var(--brass)] hover:bg-[color-mix(in_srgb,var(--brass)_12%,transparent)]"
                  >
                    <Repeat size={12} /> Part of a recurring series
                  </a>
                </Field>
              )}

              {/* Tags */}
              <Field label="Tags">
                <TagEditor transaction={t} disabled={pending} onAct={act} />
              </Field>

              {/* Notes */}
              <Field label="Note">
                {/* key remounts the editor per transaction → fresh initial value, no effect sync */}
                <NotesEditor key={t.id} transaction={t} onAct={act} />
              </Field>
            </div>

            {/* Footer — review toggle */}
            <footer className="border-t border-line px-5 py-4">
              <button
                disabled={pending}
                onClick={() => act(() => setReviewed([t.id], !t.reviewed))}
                className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.99] ${
                  t.reviewed
                    ? "border border-line bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--paper)]"
                    : "bg-[var(--jade)] text-[#06120c] hover:brightness-105"
                }`}
              >
                <Check size={16} />
                {t.reviewed ? "Reviewed — mark to review" : "Mark reviewed"}
              </button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      {children}
    </div>
  );
}

function TagEditor({
  transaction,
  disabled,
  onAct,
}: {
  transaction: TransactionRow;
  disabled: boolean;
  onAct: (fn: () => Promise<unknown>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  // After adding a tag, offer to turn it into an always-tag-this-vendor rule.
  const [ruleOffer, setRuleOffer] = useState<string | null>(null);

  function add() {
    const v = value.trim();
    setValue("");
    setAdding(false);
    if (v) {
      onAct(() => addTagToTransaction(transaction.id, v));
      setRuleOffer(v);
    }
  }

  return (
    <div className="space-y-2.5">
    <div className="flex flex-wrap items-center gap-2">
      {transaction.tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--panel-2)] px-2.5 py-1 text-xs"
        >
          {tag.name}
          <button
            aria-label={`Remove ${tag.name}`}
            disabled={disabled}
            onClick={() => onAct(() => removeTagFromTransaction(transaction.id, tag.id))}
            className="text-[var(--faint)] hover:text-[var(--coral)]"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            if (e.key === "Escape") {
              setValue("");
              setAdding(false);
            }
          }}
          placeholder="tag"
          className="w-24 rounded-full border border-line bg-[var(--ink)] px-2.5 py-1 text-xs outline-none focus:border-[var(--brass-dim)]"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
        >
          <Plus size={12} /> Add
        </button>
      )}
    </div>

    {ruleOffer && (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_8%,transparent)] px-3 py-2 text-xs">
        <span className="min-w-0 truncate text-[var(--muted)]">
          Always tag{" "}
          <span className="font-medium text-[var(--paper)]">{transaction.displayName}</span> as #
          {ruleOffer}?
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            disabled={disabled}
            onClick={() => {
              const name = ruleOffer;
              setRuleOffer(null);
              onAct(() => createTagRuleFromTransaction(transaction.id, name));
            }}
            className="rounded-full bg-[var(--brass)] px-2.5 py-1 font-medium text-[#1a1505] hover:brightness-105"
          >
            Yes
          </button>
          <button
            onClick={() => setRuleOffer(null)}
            aria-label="Dismiss"
            className="rounded-md p-1 text-[var(--faint)] hover:text-[var(--paper)]"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    )}
    </div>
  );
}

function NotesEditor({
  transaction,
  onAct,
}: {
  transaction: TransactionRow;
  onAct: (fn: () => Promise<unknown>) => void;
}) {
  // Mounted with key={transaction.id}, so initial value is always correct.
  const [value, setValue] = useState(transaction.notes ?? "");
  const initial = useRef(transaction.notes ?? "");

  function save() {
    if (value === initial.current) return;
    initial.current = value;
    onAct(() => setTransactionNotes(transaction.id, value));
  }

  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      rows={3}
      placeholder="Add a note…"
      className="w-full resize-none rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm outline-none focus:border-[var(--brass-dim)]"
    />
  );
}
