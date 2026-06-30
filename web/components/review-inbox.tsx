"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { CategoryIcon } from "@/components/category-pill";
import { TransactionDetail } from "@/components/transaction-detail";
import { setReviewed } from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type { CategoryRow, TransactionRow } from "@/lib/queries";

export function ReviewInbox({
  transactions,
  categories,
  total,
}: {
  transactions: TransactionRow[];
  categories: CategoryRow[];
  total: number;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = useMemo(
    () => transactions.find((t) => t.id === openId) ?? null,
    [transactions, openId],
  );

  function review(ids: string[]) {
    if (ids.length === 0) return;
    start(async () => {
      await setReviewed(ids, true);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-6 shadow-[var(--elev-2)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Transactions to review</p>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {total} {total === 1 ? "entry needs" : "entries need"} a look
          </p>
        </div>
        <button
          disabled={pending}
          onClick={() => review(transactions.map((t) => t.id))}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--panel-2)] px-3.5 py-1.5 text-sm font-medium text-[var(--paper)] transition hover:border-[var(--line-strong)] active:scale-[0.98]"
        >
          <Check size={14} /> Review all
        </button>
      </div>

      <ul className="-mx-2">
        {transactions.map((t) => {
          const income = t.amount < 0;
          return (
            <li
              key={t.id}
              onClick={() => setOpenId(t.id)}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--panel-2)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-[var(--brass)]">
                <CategoryIcon icon={t.categoryIcon} size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.displayName}</p>
                <p className="truncate text-xs text-[var(--muted)]">
                  {t.categoryName} · {t.accountName}
                </p>
              </div>
              <span
                className={`mono shrink-0 text-sm ${income ? "text-[var(--jade)]" : "text-[var(--paper)]"}`}
              >
                {income ? "+" : "−"}
                {formatCurrency(Math.abs(t.amount), t.currency ?? "USD")}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  review([t.id]);
                }}
                disabled={pending}
                aria-label="Mark reviewed"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-[var(--muted)] transition hover:border-[var(--jade)] hover:text-[var(--jade)]"
              >
                <Check size={14} />
              </button>
            </li>
          );
        })}
      </ul>

      <TransactionDetail
        transaction={open}
        categories={categories}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
