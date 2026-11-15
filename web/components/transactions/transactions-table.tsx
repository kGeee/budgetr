"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Paperclip } from "lucide-react";
import { TransactionDetail } from "@/components/transactions/transaction-detail";
import {
  Amount,
  CategoryDot,
  categoryColors,
  shortDate,
} from "@/components/transactions/ledger-bits";
import { setReviewed } from "@/lib/actions";
import type { CategoryRow, TransactionRow } from "@/lib/queries";

/**
 * The ledger: one ruled row per transaction, sitting on the canvas. A brass dot
 * marks a row nobody has reviewed; the short notes after a name (Pending, Split,
 * Recurring) say why a row is unusual without a pill for each.
 *
 * `dock` is the Transactions page's layout: on a wide screen the detail opens as
 * a panel beside the ledger instead of over it, and `lead` (the summary and
 * filters) shares the ledger's column so the panel runs the full height. Every
 * other caller embeds the table in a panel or dialog of its own and gets the
 * plain table with the detail opening over the page.
 */
export function TransactionsTable({
  transactions,
  categories,
  dock = false,
  lead,
  pageSize,
  total,
}: {
  transactions: TransactionRow[];
  categories: CategoryRow[];
  dock?: boolean;
  /** Rendered above the ledger, inside its column. */
  lead?: React.ReactNode;
  /** Rows shown before "Show the rest". Omit to show every row. */
  pageSize?: number;
  /** Every matching entry, when `transactions` is a capped slice of them. */
  total?: number;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [pending, start] = useTransition();
  const colors = useMemo(() => categoryColors(categories), [categories]);

  const open = useMemo(
    () => transactions.find((t) => t.id === openId) ?? null,
    [transactions, openId],
  );

  const visible =
    pageSize && !showAll && transactions.length > pageSize
      ? transactions.slice(0, pageSize)
      : transactions;
  const everything = total ?? transactions.length;
  const anyUnreviewed = visible.some((t) => !t.reviewed);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reviewSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    start(async () => {
      await setReviewed(ids, true);
      setSelected(new Set());
      router.refresh();
    });
  }

  const ledger = (
    <section aria-label="Ledger" className="min-w-0">
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-y border-[var(--brass-dim)] py-2.5">
          <span className="text-sm text-[var(--paper)]">{selected.size} selected</span>
          <button
            disabled={pending}
            onClick={reviewSelected}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[var(--jade)] px-4 text-sm font-semibold text-[var(--on-jade)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
          >
            <Check size={14} /> Review {selected.size}
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--line-strong)] text-left text-xs text-[var(--muted)]">
              <th className="w-8 pb-2.5 pl-1 font-normal">
                <span className="sr-only">Select</span>
              </th>
              <th className="w-4 pb-2.5 font-normal">
                <span className="sr-only">Review status</span>
              </th>
              <th className="w-[72px] pb-2.5 pr-4 font-normal">Date</th>
              <th className="pb-2.5 pr-4 font-normal">Description</th>
              <th className="w-[26%] pb-2.5 pr-4 font-normal">Category</th>
              <th className="w-[17%] pb-2.5 pr-4 font-normal">Account</th>
              <th className="w-[116px] pb-2.5 pr-1 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
              const isSelected = selected.has(t.id);
              const isOpen = t.id === openId;
              const flags = [
                t.pending && "Pending",
                t.splitCount > 0 && `Split ${t.splitCount} ways`,
                t.recurring && "Recurring",
                t.matched && "Matched",
              ].filter(Boolean) as string[];
              return (
                <tr
                  key={t.id}
                  onClick={() => setOpenId(isOpen ? null : t.id)}
                  aria-current={isOpen ? "true" : undefined}
                  className={`h-[50px] cursor-pointer border-b border-line transition-colors hover:bg-[var(--panel)] ${
                    isOpen
                      ? "bg-[var(--panel-2)]"
                      : isSelected
                        ? "bg-[color-mix(in_srgb,var(--brass)_6%,transparent)]"
                        : ""
                  }`}
                >
                  <td className="pl-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(t.id)}
                      aria-label={`Select ${t.displayName}`}
                      className="block h-4 w-4 cursor-pointer accent-[var(--jade)]"
                    />
                  </td>
                  <td>
                    {!t.reviewed && (
                      <span
                        className="block h-[7px] w-[7px] rounded-full bg-[var(--brass)]"
                        title="Not reviewed"
                      >
                        <span className="sr-only">Not reviewed</span>
                      </span>
                    )}
                  </td>
                  <td
                    className="mono whitespace-nowrap pr-4 text-xs text-[var(--muted)]"
                    title={t.date}
                  >
                    {shortDate(t.date)}
                  </td>
                  <td className="pr-4">
                    <span className="flex min-w-0 items-baseline gap-2.5">
                      <span
                        className={`truncate font-medium ${t.isTransfer ? "text-[var(--muted)]" : ""}`}
                      >
                        {t.displayName}
                      </span>
                      {flags.length > 0 && (
                        <span className="whitespace-nowrap text-xs text-[var(--brass)]">
                          {flags.join(" · ")}
                        </span>
                      )}
                      {t.attachmentCount > 0 && (
                        <Paperclip
                          size={12}
                          className="shrink-0 self-center text-[var(--muted)]"
                          aria-label={`${t.attachmentCount} attached ${
                            t.attachmentCount === 1 ? "receipt" : "receipts"
                          }`}
                        />
                      )}
                      {t.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="mono whitespace-nowrap text-xs text-[var(--muted)]"
                        >
                          #{tag.name}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="pr-4">
                    <span
                      className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--muted)]"
                      title={
                        t.splitCount > 0 ? `Split across ${t.splitCount} categories` : undefined
                      }
                    >
                      <CategoryDot
                    id={t.categoryId ?? t.categoryName}
                    color={t.categoryId ? colors.get(t.categoryId) : null}
                  />
                      <span className="truncate">
                        {t.splitCount > 0 ? `${t.splitCount} splits` : t.categoryName}
                        {t.isTransfer && " · not spending"}
                      </span>
                    </span>
                  </td>
                  <td className="truncate pr-4 text-[13px] text-[var(--muted)]">
                    {t.accountName}
                  </td>
                  {/* Transfers are excluded from the spend total above, so the
                      amount is dimmed to show it isn't part of that figure —
                      otherwise a $2,145 move between your own accounts reads as
                      the largest purchase on the page. */}
                  <td
                    className="pr-1 text-right"
                    title={
                      t.isTransfer
                        ? "Between your own accounts — not counted as spending"
                        : undefined
                    }
                  >
                    <Amount amount={t.amount} currency={t.currency} quiet={t.isTransfer} />
                  </td>
                </tr>
              );
            })}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="border-b border-line py-10 text-center text-[var(--muted)]">
                  No transactions here. Connect an account and hit Sync, or loosen the filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {transactions.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5 text-[13px] text-[var(--muted)]">
          <span>
            {anyUnreviewed && (
              <>
                <span
                  aria-hidden
                  className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-[var(--brass)]"
                />
                Not reviewed ·{" "}
              </>
            )}
            showing {visible.length.toLocaleString()} of {everything.toLocaleString()}
            {visible.length === transactions.length &&
              everything > transactions.length &&
              ", the most recent. Narrow the filters to reach the rest."}
          </span>
          {visible.length < transactions.length && (
            <button
              onClick={() => setShowAll(true)}
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--line-strong)] px-4 text-sm text-[var(--paper)] transition hover:bg-[var(--panel-2)]"
            >
              Show the rest
            </button>
          )}
        </div>
      )}
    </section>
  );

  const detail = (
    <TransactionDetail
      transaction={open}
      categories={categories}
      onClose={() => setOpenId(null)}
      dock={dock}
    />
  );

  if (!dock) {
    return (
      <>
        {ledger}
        {detail}
      </>
    );
  }

  return (
    <div className="xl:flex xl:items-start xl:gap-10">
      <div className="min-w-0 flex-1 space-y-7">
        {lead}
        {ledger}
      </div>
      {detail}
    </div>
  );
}
