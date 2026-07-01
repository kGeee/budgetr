"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Split } from "lucide-react";
import { CategoryPill } from "@/components/category-pill";
import { TransactionDetail } from "@/components/transaction-detail";
import { setReviewed } from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type { CategoryRow, TransactionRow } from "@/lib/queries";

export function TransactionsTable({
  transactions,
  categories,
}: {
  transactions: TransactionRow[];
  categories: CategoryRow[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const open = useMemo(
    () => transactions.find((t) => t.id === openId) ?? null,
    [transactions, openId],
  );

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

  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_8%,transparent)] px-4 py-2.5">
          <span className="text-sm text-[var(--paper)]">
            {selected.size} selected
          </span>
          <button
            disabled={pending}
            onClick={reviewSelected}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--jade)] px-3.5 py-1.5 text-sm font-medium text-[#06120c] transition hover:brightness-105 active:scale-[0.98]"
          >
            <Check size={14} /> Review {selected.size}
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-[var(--radius)] border border-line bg-[var(--panel)]">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="w-10 px-4 py-3.5" />
              {["Date", "Description", "Category", "Account", "Amount"].map((h, i) => (
                <th
                  key={h}
                  className={`px-6 py-3.5 eyebrow font-medium ${i === 4 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => {
              const income = t.amount < 0;
              const isSelected = selected.has(t.id);
              return (
                <tr
                  key={t.id}
                  onClick={() => setOpenId(t.id)}
                  className={`cursor-pointer border-b border-line/60 last:border-0 transition-colors hover:bg-[var(--panel-2)] ${
                    isSelected ? "bg-[color-mix(in_srgb,var(--brass)_6%,transparent)]" : ""
                  }`}
                >
                  <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(t.id)}
                      aria-label={`Select ${t.displayName}`}
                      className="h-4 w-4 cursor-pointer accent-[var(--jade)]"
                    />
                  </td>
                  <td className="mono whitespace-nowrap px-6 py-3.5 text-[var(--muted)]">
                    {t.date}
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="flex items-center gap-2">
                      {!t.reviewed && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brass)]"
                          title="Not reviewed"
                        />
                      )}
                      <span className="font-medium">{t.displayName}</span>
                      {t.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-[var(--muted)]"
                        >
                          {tag.name}
                        </span>
                      ))}
                      {t.pending && (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                          pending
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="flex items-center gap-1.5">
                      {t.splitCount > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--panel-2)] px-2.5 py-1 text-xs text-[var(--brass)]"
                          title={`Split across ${t.splitCount} categories`}
                        >
                          <Split size={13} /> {t.splitCount} splits
                        </span>
                      ) : (
                        <CategoryPill name={t.categoryName} icon={t.categoryIcon} />
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5 text-[var(--muted)]">
                    {t.accountName}
                  </td>
                  <td
                    className={`mono whitespace-nowrap px-6 py-3.5 text-right ${
                      income ? "text-[var(--jade)]" : "text-[var(--paper)]"
                    }`}
                  >
                    {income ? "+" : "−"}
                    {formatCurrency(Math.abs(t.amount), t.currency ?? "USD")}
                  </td>
                </tr>
              );
            })}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-[var(--muted)]">
                  No transactions yet — connect an account and hit Sync.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TransactionDetail
        transaction={open}
        categories={categories}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
