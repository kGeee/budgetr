import { PageHead } from "@/components/page-head";
import { MatchesReview } from "@/components/matches-review";
import { TransactionsTable } from "@/components/transactions-table";
import { TransactionsFilterBar } from "@/components/transactions-filter-bar";
import {
  getAccounts,
  getCategories,
  getSavedFilters,
  getTags,
  searchTransactions,
  type TxnCriteria,
} from "@/lib/queries";
import { suggestMatches } from "@/lib/matching";

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

  return c;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const criteria = parseCriteria(await searchParams);
  const filtered = Object.keys(criteria).length > 0;

  const txns = searchTransactions(criteria, 500);
  const categories = getCategories();
  const tags = getTags();
  const accounts = getAccounts().map((a) => ({ id: a.id, name: a.name }));
  const savedFilters = getSavedFilters();
  const suggestions = filtered ? [] : suggestMatches();
  const unreviewed = txns.filter((t) => !t.reviewed).length;

  return (
    <div className="space-y-7">
      <PageHead title="Transactions" />
      <p className="-mt-3 text-sm text-[var(--muted)]">
        {filtered ? (
          <>
            {txns.length} matching {txns.length === 1 ? "entry" : "entries"}
          </>
        ) : (
          <>
            {txns.length} most recent {txns.length === 1 ? "entry" : "entries"}
          </>
        )}
        {unreviewed > 0 && (
          <span className="text-[var(--brass)]"> · {unreviewed} to review</span>
        )}
      </p>

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
