"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { SectionHead } from "@/components/ui/statement";
import {
  Amount,
  CategoryDot,
  categoryColors,
  shortDate,
} from "@/components/transactions/ledger-bits";
import { TransactionDetail } from "@/components/transactions/transaction-detail";
import { setReviewed, setTransactionCategory, suggestForTransaction } from "@/lib/actions";
import type { CategoryRow, CategorySuggestion, TransactionRow } from "@/lib/queries";

const REVIEW_ALL_BTN =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--line-strong)] bg-[var(--panel)] px-4 text-sm font-medium text-[var(--paper)] transition hover:bg-[var(--panel-2)] active:scale-[0.98] disabled:opacity-50";

/**
 * Marks the loaded rows reviewed. Only those rows are marked, so the label says
 * so when that isn't the whole backlog — "all" never quietly means "these".
 */
export function ReviewAllButton({
  ids,
  total,
  className,
}: {
  ids: string[];
  total: number;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (ids.length === 0) return null;
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setReviewed(ids, true);
          router.refresh();
        })
      }
      className={className ?? REVIEW_ALL_BTN}
    >
      <Check size={14} />
      {ids.length < total ? `Review these ${ids.length}` : `Review all ${total.toLocaleString()}`}
    </button>
  );
}

/**
 * The review queue as ruled rows: what it is, the one-click category the vendor
 * was filed under before, the amount, and a tick to confirm it as it stands.
 * Opening a row brings up the full detail panel.
 */
export function ReviewInbox({
  transactions,
  categories,
  total,
  href,
  title = "Inbox",
  bare = false,
  reviewAll = true,
}: {
  transactions: TransactionRow[];
  categories: CategoryRow[];
  total: number;
  /** Where the full inbox lives — set when this is a preview (the Home widget). */
  href?: string;
  title?: string;
  /** Rows only, no title rule or footnote — for embedding under another head. */
  bare?: boolean;
  /** Show "Review all" in the title rule. Off when the page's hero carries it. */
  reviewAll?: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const colors = useMemo(() => categoryColors(categories), [categories]);

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

  const rows = (
    <ul>
      {transactions.map((t) => (
        <li
          key={t.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3"
        >
          <button
            type="button"
            onClick={() => setOpenId(t.id)}
            className="flex min-w-0 flex-[1_1_240px] items-center gap-3 text-left"
          >
            <CategoryDot
                    id={t.categoryId ?? t.categoryName}
                    color={t.categoryId ? colors.get(t.categoryId) : null}
                  />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{t.displayName}</span>
              <span className="block truncate text-[13px] text-[var(--muted)]">
                {t.categoryName}
                {t.accountName && ` · ${t.accountName}`} · {shortDate(t.date)}
              </span>
            </span>
          </button>
          <InboxSuggestion txn={t} disabled={pending} />
          <Amount amount={t.amount} currency={t.currency} className="w-24 text-right text-sm" />
          <button
            onClick={() => review([t.id])}
            disabled={pending}
            aria-label={`Mark ${t.displayName} reviewed`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--jade)] transition hover:bg-[color-mix(in_srgb,var(--jade)_10%,transparent)] disabled:opacity-50"
          >
            <Check size={16} />
          </button>
        </li>
      ))}
    </ul>
  );

  const detail = (
    <TransactionDetail transaction={open} categories={categories} onClose={() => setOpenId(null)} />
  );

  if (bare) {
    return (
      <>
        {rows}
        {detail}
      </>
    );
  }

  return (
    <section aria-label={title}>
      <SectionHead
        title={title}
        count={href ? total.toLocaleString() : undefined}
        action={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {href ? (
              <Link
                href={href}
                className="text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
              >
                Open review
              </Link>
            ) : (
              <span className="text-xs text-[var(--muted)]">
                Open a row for the full detail panel
              </span>
            )}
            {reviewAll && (
              <ReviewAllButton
                ids={transactions.map((t) => t.id)}
                total={total}
                className="inline-flex items-center gap-1.5 text-[13px] text-[var(--paper)] transition-colors hover:text-[var(--jade)] disabled:opacity-50"
              />
            )}
          </span>
        }
      />
      {rows}
      <p className="mt-3 text-xs text-[var(--muted)]">
        The dashed chip is a one-click category from how this vendor was filed before. It only
        appears when it disagrees with the current category.
      </p>
      {detail}
    </section>
  );
}

/**
 * One-click category suggestion inline in an inbox row: lazily learns how this
 * vendor was classified before and, when that disagrees with the row's current
 * category, offers to apply it without opening the drawer. Hidden when there's
 * no history or the guess already matches.
 */
function InboxSuggestion({ txn, disabled }: { txn: TransactionRow; disabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sug, setSug] = useState<CategorySuggestion | null>(null);

  useEffect(() => {
    let alive = true;
    suggestForTransaction(txn.id).then((s) => {
      if (alive) setSug(s.category);
    });
    return () => {
      alive = false;
    };
  }, [txn.id]);

  if (!sug || sug.categoryId === txn.categoryId || txn.splitCount > 0) return null;

  return (
    <button
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          await setTransactionCategory(txn.id, sug.categoryId);
          router.refresh();
        })
      }
      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-dashed border-[var(--brass-dim)] px-3.5 text-[13px] text-[var(--brass)] transition hover:bg-[color-mix(in_srgb,var(--brass)_10%,transparent)] disabled:opacity-50"
    >
      <Sparkles size={12} className="shrink-0" />
      <span className="truncate">Set {sug.categoryName}</span>
    </button>
  );
}
