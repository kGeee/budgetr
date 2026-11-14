import Link from "next/link";
import { ListChecks } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { Card } from "@/components/ui/card";
import { MatchesReview } from "@/components/transactions/matches-review";
import { ReviewInbox } from "@/components/transactions/review-inbox";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { TransactionsFilterBar } from "@/components/transactions/transactions-filter-bar";
import {
  countUnreviewed,
  getAccounts,
  getCategories,
  getSavedFilters,
  getTags,
  getTransactionsToReview,
  searchTransactions,
  summarizeTransactions,
  type TxnCriteria,
} from "@/lib/queries";
import { suggestMatches } from "@/lib/matching";
import { formatCurrency } from "@/lib/utils";

/** "Mar 26 – Aug 1", collapsing to one date when the range is a single day. */
function formatDayRange(from: string, to: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

/** Parse the transactions querystring into a TxnCriteria (empty ⇒ show recent). */
function parseCriteria(sp: SearchParams): TxnCriteria {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const c: TxnCriteria = {};

  const q = one(sp.q)?.trim();
  if (q) c.q = q;
  const account = one(sp.account);
  if (account) c.accountId = account;
  const category = one(sp.category);
  if (category) c.categoryId = category;
  const tag = one(sp.tag);
  if (tag) c.tagId = tag;
  const from = one(sp.from);
  if (from) c.dateFrom = from;
  const to = one(sp.to);
  if (to) c.dateTo = to;

  const minRaw = one(sp.min);
  const min = Number(minRaw);
  if (minRaw && !Number.isNaN(min)) c.amountMin = min;
  const maxRaw = one(sp.max);
  const max = Number(maxRaw);
  if (maxRaw && !Number.isNaN(max)) c.amountMax = max;

  // ?reviewed=no is the destination of the review-backlog health alert, so it
  // has to actually narrow the list — an action that silently shows everything
  // is worse than no action.
  const reviewed = one(sp.reviewed);
  if (reviewed === "no") c.reviewed = false;
  else if (reviewed === "yes") c.reviewed = true;

  return c;
}

// The inbox loads a page at a time; reviewing a batch refreshes in the next one.
const REVIEW_PAGE = 100;

/** All ⇄ Needs review. Server-rendered links: the view lives in the URL. */
function ViewTabs({ view, reviewCount }: { view: "all" | "review"; reviewCount: number }) {
  const tabs = [
    { key: "all", href: "/transactions", label: "All" },
    { key: "review", href: "/transactions?view=review", label: "Needs review" },
  ] as const;
  return (
    <nav aria-label="Transactions view" className="flex gap-1.5">
      {tabs.map((t) => {
        const on = t.key === view;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              on
                ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
            }`}
          >
            {t.label}
            {t.key === "review" && reviewCount > 0 && (
              <span className="mono rounded-full bg-[color-mix(in_srgb,var(--brass)_18%,transparent)] px-1.5 text-xs text-[var(--brass)]">
                {reviewCount.toLocaleString()}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const reviewCount = countUnreviewed();

  if (sp.view === "review") {
    const queue = getTransactionsToReview(REVIEW_PAGE);
    return (
      <div className="space-y-7">
        <PageHead
          title="Transactions"
          action={<ViewTabs view="review" reviewCount={reviewCount} />}
        />
        {reviewCount === 0 ? (
          <Card className="flex min-h-[220px] flex-col items-center justify-center text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-line text-[var(--jade)]">
              <ListChecks size={20} />
            </span>
            <p className="mt-4 font-display text-lg text-[var(--paper)]">All caught up</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Every settled transaction has been reviewed.
            </p>
          </Card>
        ) : (
          <ReviewInbox transactions={queue} categories={getCategories()} total={reviewCount} />
        )}
      </div>
    );
  }

  const criteria = parseCriteria(sp);
  const filtered = Object.keys(criteria).length > 0;

  const txns = searchTransactions(criteria, 500);
  const categories = getCategories();
  const tags = getTags();
  const accounts = getAccounts().map((a) => ({ id: a.id, name: a.name }));
  const savedFilters = getSavedFilters();
  const suggestions = filtered ? [] : suggestMatches();

  // Over every match, not the capped slice below — "500 most recent entries"
  // read as a total when it was a ceiling, and a filtered view never told you
  // what it cost.
  const summary = summarizeTransactions(criteria);
  const capped = summary.total > txns.length;

  return (
    <div className="space-y-7">
      <PageHead title="Transactions" action={<ViewTabs view="all" reviewCount={reviewCount} />} />
      <div className="-mt-3 space-y-2">
        <p className="text-sm text-[var(--muted)]">
          {summary.total.toLocaleString()} {filtered ? "matching " : ""}
          {summary.total === 1 ? "entry" : "entries"}
          {summary.firstDate && summary.lastDate && (
            <> · {formatDayRange(summary.firstDate, summary.lastDate)}</>
          )}
          {capped && <> · showing {txns.length.toLocaleString()} most recent</>}
        </p>
        {summary.total > 0 && (
          <p className="text-sm">
            <span className="font-medium text-[var(--paper)]">
              {formatCurrency(summary.spent)}
            </span>{" "}
            <span className="text-[var(--muted)]">out against</span>{" "}
            <span className="font-medium text-[var(--paper)]">
              {formatCurrency(summary.received)}
            </span>{" "}
            <span className="text-[var(--muted)]">in.</span>
            {summary.transferred > 0 && (
              <span className="text-[var(--muted)]">
                {" "}
                A further {formatCurrency(summary.transferred)} moved between your own
                accounts — not counted as spending.
              </span>
            )}
            {summary.unreviewed > 0 && (
              <span className="text-[var(--brass)]">
                {" "}
                {summary.unreviewed.toLocaleString()} never reviewed.
              </span>
            )}
          </p>
        )}
      </div>

      <TransactionsFilterBar
        criteria={criteria}
        categories={categories}
        accounts={accounts}
        tags={tags}
        savedFilters={savedFilters}
        resultCount={txns.length}
      />

      <MatchesReview suggestions={suggestions} />

      <TransactionsTable transactions={txns} categories={categories} />
    </div>
  );
}
