import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { Hero, Mark, Stat, StatStrip, Verdict } from "@/components/ui/statement";
import { MatchesReview } from "@/components/transactions/matches-review";
import { ReviewAllButton, ReviewInbox } from "@/components/transactions/review-inbox";
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
import { getIncludePending } from "@/lib/pending";
import { ledgerVerdict, reviewVerdict, type StatementVerdict } from "@/lib/transactions-verdict";
import { formatCurrency } from "@/lib/utils";

/** A verdict as a sentence, its amount formatted here so privacy mode holds. */
function VerdictLine({ v }: { v: StatementVerdict }) {
  return (
    <>
      {v.lead}
      {v.amount != null && (
        <>
          {" "}
          <Mark tone={v.tone}>{formatCurrency(v.amount)}</Mark> {v.tail}
        </>
      )}
    </>
  );
}

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

// Ledger rows on screen before "Show the rest" reveals everything loaded.
const LEDGER_PAGE = 100;

const META_LINK = "text-[var(--brass)] hover:underline";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const reviewCount = countUnreviewed();

  if (sp.view === "review") {
    const queue = getTransactionsToReview(REVIEW_PAGE);
    // Offsetting pairs sit beside the inbox: linking one is the same kind of
    // decision as confirming a row, and it takes both legs out of the totals.
    const matches = suggestMatches();
    const pairs = matches.length;
    // The loaded rows' own amounts, as the inbox lists them: what is waiting on
    // a look, split by direction.
    const out = queue.reduce((s, t) => s + Math.max(t.amount, 0), 0);
    const inn = queue.reduce((s, t) => s + Math.max(-t.amount, 0), 0);
    return (
      <div className="space-y-9">
        <PageHead title="Transactions" />
        <section className="rise space-y-5" aria-label="To review">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
            <Hero
              eyebrow={
                reviewCount === 0 ? "Transactions to review · all caught up" : "Transactions to review"
              }
              figure={reviewCount.toLocaleString()}
              tone={reviewCount === 0 ? "jade" : "default"}
              verdict={
                <>
                  <VerdictLine
                    v={reviewVerdict({ total: reviewCount, loaded: queue.length, out, in: inn })}
                  />
                  {pairs > 0 && (
                    <>
                      {" "}
                      <Mark tone="brass">
                        {pairs === 1 ? "One offsetting pair" : `${pairs} offsetting pairs`}
                      </Mark>{" "}
                      could be linked so {pairs === 1 ? "it isn’t" : "they aren’t"} counted twice.
                    </>
                  )}
                </>
              }
            />
            <ReviewAllButton ids={queue.map((t) => t.id)} total={reviewCount} />
          </div>
          {reviewCount > 0 && (
            <StatStrip>
              <Stat
                label="Loaded here"
                value={queue.length.toLocaleString()}
                sub={
                  queue.length < reviewCount
                    ? `of ${reviewCount.toLocaleString()} · newest first`
                    : "the whole backlog"
                }
              />
              <Stat label="Out" value={formatCurrency(out)} />
              <Stat label="In" value={formatCurrency(inn)} tone={inn > 0 ? "jade" : "default"} />
            </StatStrip>
          )}
        </section>
        {(reviewCount > 0 || pairs > 0) && (
          <div
            className={`grid gap-x-12 gap-y-9 ${
              reviewCount > 0 && pairs > 0 ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""
            }`}
          >
            {reviewCount > 0 && (
              <ReviewInbox
                transactions={queue}
                categories={getCategories()}
                total={reviewCount}
                reviewAll={false}
              />
            )}
            <MatchesReview suggestions={matches} />
          </div>
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
  // Possible matches are worked through in Review; here they are one line that
  // says they exist. Only counted on the unfiltered ledger, as before.
  const pairs = filtered ? 0 : suggestMatches().length;

  // Over every match, not the capped slice below — "500 most recent entries"
  // read as a total when it was a ceiling, and a filtered view never told you
  // what it cost.
  const summary = summarizeTransactions(criteria);
  const capped = summary.total > txns.length;
  const verdict = ledgerVerdict({
    total: summary.total,
    spent: summary.spent,
    received: summary.received,
    filtered,
  });
  const bothWays = summary.spent > 0.005 && summary.received > 0.005;

  return (
    <div className="space-y-7">
      <PageHead title="Transactions" />
      <TransactionsTable
        dock
        transactions={txns}
        categories={categories}
        pageSize={LEDGER_PAGE}
        total={summary.total}
        lead={
          <>
            {/* What the matches cost, over every match rather than the capped
                slice: one sentence setting money out against money in, then
                the counts on a quiet line. */}
            <section className="rise space-y-2" aria-label="Summary of these transactions">
              <Verdict className="max-w-[60ch]">
                {summary.total === 0 ? (
                  <VerdictLine v={verdict} />
                ) : (
                  <>
                    <span className="tabular">{formatCurrency(summary.spent)}</span> out against{" "}
                    <Mark tone={summary.received > 0 ? "jade" : "muted"}>
                      {formatCurrency(summary.received)}
                    </Mark>{" "}
                    in.
                    {bothWays && verdict.amount != null && (
                      <>
                        {" "}
                        <VerdictLine v={verdict} />
                      </>
                    )}
                    {summary.transferred > 0 && (
                      <span className="text-[var(--muted)]">
                        {" "}
                        A further {formatCurrency(summary.transferred)} moved between your own
                        accounts, not counted as spending.
                      </span>
                    )}
                  </>
                )}
              </Verdict>
              {summary.total > 0 && (
                <p className="text-[13px] text-[var(--muted)]">
                  {summary.total.toLocaleString()} {filtered ? "matching " : ""}
                  {summary.total === 1 ? "entry" : "entries"}
                  {summary.firstDate && summary.lastDate && (
                    <> · {formatDayRange(summary.firstDate, summary.lastDate)}</>
                  )}
                  {capped && <> · the {txns.length.toLocaleString()} most recent loaded</>}
                  {summary.unreviewed > 0 && (
                    <>
                      {" · "}
                      <Link href="/transactions?reviewed=no" className={META_LINK}>
                        {summary.unreviewed.toLocaleString()} not reviewed
                      </Link>
                    </>
                  )}
                  {pairs > 0 && (
                    <>
                      {" · "}
                      <Link href="/transactions?view=review" className={META_LINK}>
                        {pairs} possible {pairs === 1 ? "match" : "matches"} to link
                      </Link>
                    </>
                  )}
                </p>
              )}
            </section>

            <TransactionsFilterBar
              // Re-seed the controls when a link (not the bar) changes the criteria.
              key={JSON.stringify(criteria)}
              criteria={criteria}
              categories={categories}
              accounts={accounts}
              tags={tags}
              savedFilters={savedFilters}
              countPending={getIncludePending()}
            />
          </>
        }
      />
    </div>
  );
}
