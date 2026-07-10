"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Check,
  Download,
  FileText,
  Paperclip,
  Plus,
  Repeat,
  Sparkles,
  Split,
  Trash2,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { CategoryIcon } from "@/components/category-pill";
import {
  addTagToTransaction,
  applyCategoryToVendor,
  clearSplits,
  createTagRuleFromTransaction,
  deleteAttachment,
  getVendorReclassCount,
  loadAttachments,
  loadMatchCounterpart,
  loadTransactionSplits,
  removeTagFromTransaction,
  setReviewed,
  setTransactionCategory,
  setTransactionNotes,
  setTransactionSplits,
  suggestForTransaction,
  unmatch,
  uploadAttachment,
} from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type {
  AttachmentRow,
  CategoryRow,
  CategorySuggestion,
  TagSuggestion,
  TransactionRow,
} from "@/lib/queries";
import type { MatchCounterpart } from "@/lib/matching";

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
  // History-based category/tag suggestions, fetched lazily when a txn opens.
  const txnId = t?.id;
  const [catSuggestion, setCatSuggestion] = useState<CategorySuggestion | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);

  // Reset per-transaction state when a different transaction opens
  // (adjust-state-on-prop-change).
  const [offerTxnId, setOfferTxnId] = useState(t?.id);
  if (t?.id !== offerTxnId) {
    setOfferTxnId(t?.id);
    setCatOffer(null);
    setCatSuggestion(null);
    setTagSuggestions([]);
  }

  useEffect(() => {
    if (!txnId) return;
    let alive = true;
    suggestForTransaction(txnId).then((s) => {
      if (!alive) return;
      setCatSuggestion(s.category);
      setTagSuggestions(s.tags);
    });
    return () => {
      alive = false;
    };
  }, [txnId]);

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
        className={`material-thick fixed right-0 top-0 z-40 flex h-dvh w-full max-w-[400px] flex-col border-l border-line shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)] transition-transform duration-300 ease-[var(--ease)] will-change-transform ${
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
                  className={`display-1 font-display text-4xl tabular ${income ? "text-[var(--jade)]" : "text-[var(--paper)]"}`}
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
                  {catSuggestion &&
                    catSuggestion.categoryId !== t.categoryId &&
                    t.splitCount === 0 && (
                      <button
                        disabled={pending}
                        onClick={() => {
                          setCatSuggestion(null);
                          changeCategory(catSuggestion.categoryId);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_8%,transparent)] px-3 py-2 text-left text-xs transition hover:brightness-110 disabled:opacity-50"
                      >
                        <Sparkles size={13} className="shrink-0 text-[var(--brass)]" />
                        <span className="min-w-0 flex-1 text-[var(--muted)]">
                          Suggested:{" "}
                          <span className="font-medium text-[var(--paper)]">
                            {catSuggestion.categoryName}
                          </span>{" "}
                          <span className="text-[var(--faint)]">
                            ({Math.round(catSuggestion.confidence * 100)}% of{" "}
                            {catSuggestion.count} past)
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-[var(--brass)] px-2.5 py-1 font-medium text-[#1a1505]">
                          Apply
                        </span>
                      </button>
                    )}

                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--brass)]">
                      <CategoryIcon icon={t.categoryIcon} size={15} />
                    </span>
                    <select
                      value={t.categoryId ?? ""}
                      disabled={pending || t.splitCount > 0}
                      onChange={(e) => changeCategory(e.target.value || null)}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm outline-none focus:border-[var(--brass-dim)] disabled:opacity-50"
                    >
                      <option value="">Auto (from Plaid)</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {t.splitCount > 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      Category is managed by the {t.splitCount} splits below.
                    </p>
                  )}

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

              {/* Split */}
              <Field label="Split">
                {/* key remounts per transaction → fresh load of that txn's splits */}
                <SplitEditor key={t.id} transaction={t} categories={categories} />
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

              {/* Matched refund/transfer counterpart */}
              {t.matched && (
                <Field label="Matched">
                  {/* key remounts per transaction → fresh load of the counterpart */}
                  <MatchInfo key={t.id} transaction={t} onAct={act} />
                </Field>
              )}

              {/* Tags */}
              <Field label="Tags">
                <TagEditor
                  transaction={t}
                  disabled={pending}
                  onAct={act}
                  suggestions={tagSuggestions}
                />
              </Field>

              {/* Notes */}
              <Field label="Note">
                {/* key remounts the editor per transaction → fresh initial value, no effect sync */}
                <NotesEditor key={t.id} transaction={t} onAct={act} />
              </Field>

              {/* Receipts */}
              <Field label="Receipts">
                {/* key remounts per transaction → fresh load of that txn's files */}
                <AttachmentsEditor key={t.id} transaction={t} />
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
  suggestions = [],
}: {
  transaction: TransactionRow;
  disabled: boolean;
  onAct: (fn: () => Promise<unknown>) => void;
  suggestions?: TagSuggestion[];
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  // After adding a tag, offer to turn it into an always-tag-this-vendor rule.
  const [ruleOffer, setRuleOffer] = useState<string | null>(null);

  // Hide suggestions already present on the txn (query excludes them too, but the
  // list is fetched once so filter locally to reflect just-added tags instantly).
  const applied = new Set(transaction.tags.map((tg) => tg.id));
  const fresh = suggestions.filter((s) => !applied.has(s.id));

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

    {fresh.length > 0 && (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--faint)]">
          <Sparkles size={11} className="text-[var(--brass)]" /> Suggested
        </span>
        {fresh.map((s) => (
          <button
            key={s.id}
            disabled={disabled}
            onClick={() => onAct(() => addTagToTransaction(transaction.id, s.name))}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--brass-dim)] px-2.5 py-1 text-xs text-[var(--muted)] transition hover:bg-[color-mix(in_srgb,var(--brass)_10%,transparent)] hover:text-[var(--paper)] disabled:opacity-50"
          >
            <Plus size={12} /> {s.name}
          </button>
        ))}
      </div>
    )}

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

/**
 * Shows the confirmed refund/transfer counterpart of a matched transaction and an
 * Unmatch control. Loads the counterpart lazily (component is keyed by txn id) so
 * the drawer stays cheap for the common unmatched case.
 */
function MatchInfo({
  transaction,
  onAct,
}: {
  transaction: TransactionRow;
  onAct: (fn: () => Promise<unknown>) => void;
}) {
  const [counterpart, setCounterpart] = useState<MatchCounterpart | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadMatchCounterpart(transaction.id).then((c) => {
      if (!alive) return;
      setCounterpart(c);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [transaction.id]);

  if (loading) {
    return <p className="text-xs text-[var(--muted)]">Loading linked transaction…</p>;
  }
  if (!counterpart) {
    return <p className="text-xs text-[var(--muted)]">This match was removed.</p>;
  }

  const income = counterpart.amount < 0;
  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-[var(--panel-2)] p-3">
      <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
        <ArrowLeftRight size={12} className="text-[var(--brass)]" />
        Linked as a <span className="font-medium text-[var(--paper)]">{counterpart.kind}</span> —
        excluded from cashflow &amp; spend
      </p>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-medium">{counterpart.displayName}</span>
          <span className="block text-xs text-[var(--muted)]">
            {counterpart.accountName ?? "—"} · {counterpart.date}
          </span>
        </span>
        <span
          className={`mono shrink-0 tabular ${income ? "text-[var(--jade)]" : "text-[var(--paper)]"}`}
        >
          {income ? "+" : "−"}
          {formatCurrency(Math.abs(counterpart.amount), counterpart.currency ?? "USD")}
        </span>
      </div>
      <button
        onClick={() => onAct(() => unmatch(counterpart.matchId))}
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--coral)] hover:text-[var(--coral)]"
      >
        <Unlink size={13} /> Unmatch
      </button>
    </div>
  );
}

type SplitRow = { categoryId: string; amount: string };

/**
 * Divide one transaction's amount across categories. Works in absolute values
 * (the parent transaction's sign is reapplied on save) with a live remainder so
 * splits are only saveable once they reconcile to the full amount.
 */
function SplitEditor({
  transaction,
  categories,
}: {
  transaction: TransactionRow;
  categories: CategoryRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Math.abs(transaction.amount);
  const sign = transaction.amount < 0 ? -1 : 1;
  const currency = transaction.currency ?? "USD";

  // Load existing splits on mount (component is keyed by transaction id).
  useEffect(() => {
    if (transaction.splitCount === 0) return;
    let alive = true;
    loadTransactionSplits(transaction.id).then((splits) => {
      if (!alive) return;
      setRows(splits.map((s) => ({ categoryId: s.categoryId ?? "", amount: String(Math.abs(s.amount)) })));
      setEditing(true);
    });
    return () => {
      alive = false;
    };
  }, [transaction.id, transaction.splitCount]);

  const allocated = rows.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  const remainder = Math.round((total - allocated) * 100) / 100;
  const balanced = Math.abs(remainder) < 0.01;

  function startSplit() {
    setError(null);
    // Seed with the current category taking the whole amount, plus an empty row.
    setRows([
      { categoryId: transaction.categoryId ?? "", amount: total.toFixed(2) },
      { categoryId: "", amount: "" },
    ]);
    setEditing(true);
  }

  function update(i: number, patch: Partial<SplitRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    // Default the new row's amount to whatever's left to allocate.
    const left = remainder > 0 ? remainder.toFixed(2) : "";
    setRows((prev) => [...prev, { categoryId: "", amount: left }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, j) => j !== i));
  }

  function save() {
    setError(null);
    const splits = rows
      .filter((r) => (parseFloat(r.amount) || 0) !== 0)
      .map((r) => ({
        categoryId: r.categoryId || null,
        amount: sign * (parseFloat(r.amount) || 0),
      }));
    if (splits.length === 0) {
      setError("Add at least one split with an amount.");
      return;
    }
    start(async () => {
      const res = await setTransactionSplits(transaction.id, splits);
      if (!res.ok) {
        setError(res.error ?? "Could not save splits.");
        return;
      }
      router.refresh();
    });
  }

  function stopSplitting() {
    setError(null);
    if (transaction.splitCount > 0) {
      // Persisted splits — clear them in the DB.
      start(async () => {
        await clearSplits(transaction.id);
        setRows([]);
        setEditing(false);
        router.refresh();
      });
    } else {
      // Never saved — just drop the local draft.
      setRows([]);
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={startSplit}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
      >
        <Split size={13} /> Split across categories
      </button>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={r.categoryId}
              disabled={pending}
              onChange={(e) => update(i, { categoryId: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={r.amount}
              disabled={pending}
              inputMode="decimal"
              onChange={(e) => update(i, { amount: e.target.value.replace(/[^0-9.]/g, "") })}
              placeholder="0.00"
              className="w-24 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-right text-sm tabular outline-none focus:border-[var(--brass-dim)]"
            />
            <button
              onClick={() => removeRow(i)}
              disabled={pending}
              aria-label="Remove split"
              className="shrink-0 rounded-md p-1 text-[var(--faint)] hover:text-[var(--coral)]"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={addRow}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
        >
          <Plus size={12} /> Add split
        </button>
        <span
          className={`text-xs tabular ${balanced ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}
        >
          {balanced
            ? `Balanced · ${formatCurrency(total, currency)}`
            : `${formatCurrency(Math.abs(remainder), currency)} ${remainder > 0 ? "left" : "over"}`}
        </span>
      </div>

      {error && <p className="text-xs text-[var(--coral)]">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending || !balanced}
          className="flex-1 rounded-full bg-[var(--brass)] px-3 py-1.5 text-xs font-medium text-[#1a1505] transition hover:brightness-105 disabled:opacity-40"
        >
          Save splits
        </button>
        <button
          onClick={stopSplitting}
          disabled={pending}
          className="rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--paper)]"
        >
          {transaction.splitCount > 0 ? "Remove splits" : "Cancel"}
        </button>
      </div>
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

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload receipt/invoice files to a transaction and list them with inline image
 * thumbnails (served from the auth-scoped /api/attachments route), a download
 * link, and per-file delete. Loads existing files lazily — the component is
 * keyed by transaction id, so mount === "this txn's attachments".
 */
function AttachmentsEditor({ transaction }: { transaction: TransactionRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // null = not yet fetched; loading is derived so the effect never sets
  // state synchronously (react-hooks/set-state-in-effect).
  const [files, setFiles] = useState<AttachmentRow[] | null>(null);
  const loading = transaction.attachmentCount > 0 && files === null;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (transaction.attachmentCount === 0) return;
    let alive = true;
    loadAttachments(transaction.id).then((rows) => {
      if (!alive) return;
      setFiles(rows);
    });
    return () => {
      alive = false;
    };
  }, [transaction.id, transaction.attachmentCount]);

  function upload(file: File) {
    setError(null);
    const form = new FormData();
    form.set("transactionId", transaction.id);
    form.set("file", file);
    start(async () => {
      const res = await uploadAttachment(form);
      if (!res.ok) {
        setError(res.error ?? "Upload failed.");
        return;
      }
      setFiles(await loadAttachments(transaction.id));
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      await deleteAttachment(id);
      setFiles((prev) => (prev ?? []).filter((f) => f.id !== id));
      router.refresh();
    });
  }

  return (
    <div className="space-y-2.5">
      {loading ? (
        <p className="text-xs text-[var(--muted)]">Loading receipts…</p>
      ) : (
        (files ?? []).length > 0 && (
          <ul className="space-y-2">
            {(files ?? []).map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-lg border border-line bg-[var(--panel-2)] p-2"
              >
                <a
                  href={`/api/attachments/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-[var(--ink)] text-[var(--muted)]"
                  title="Open"
                >
                  {f.isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/attachments/${f.id}`}
                      alt={f.originalName ?? "receipt"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <FileText size={18} />
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/attachments/${f.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm hover:text-[var(--brass)]"
                    title={f.originalName ?? "attachment"}
                  >
                    {f.originalName ?? "attachment"}
                  </a>
                  <p className="mono text-[11px] text-[var(--muted)]">
                    {[
                      formatBytes(f.size),
                      new Date(f.createdAt).toLocaleDateString(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <a
                  href={`/api/attachments/${f.id}?download=1`}
                  aria-label="Download"
                  className="shrink-0 rounded-md p-1.5 text-[var(--faint)] hover:text-[var(--paper)]"
                >
                  <Download size={15} />
                </a>
                <button
                  onClick={() => remove(f.id)}
                  disabled={pending}
                  aria-label="Delete attachment"
                  className="shrink-0 rounded-md p-1.5 text-[var(--faint)] hover:text-[var(--coral)]"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {!loading && (files ?? []).length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <Paperclip size={12} /> No receipts attached yet.
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--brass-dim)] hover:text-[var(--paper)] disabled:opacity-50"
      >
        <Upload size={13} /> {pending ? "Uploading…" : "Attach receipt"}
      </button>

      {error && <p className="text-xs text-[var(--coral)]">{error}</p>}
    </div>
  );
}
