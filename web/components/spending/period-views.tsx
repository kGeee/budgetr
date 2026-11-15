"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Figure, Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import { MonthlySpendChart } from "@/components/charts";
import { CategoryDetailPanel } from "@/components/budget/category-detail-panel";
import { PeriodSpendChart } from "@/components/budget/period-spend-chart";
import { spendingVerdict } from "@/lib/spending-verdict";
import { formatMoney } from "@/lib/utils";
import type {
  BiggestPurchase,
  CategoryDetail,
  CategoryRow,
  CategorySpend,
  PeriodTotals,
  TopMerchant,
} from "@/lib/queries";
import { spendingHref } from "./href";
import {
  CategoryDot,
  RuledRow,
  ShareBar,
  ShiftsTable,
  quietPill,
  type CategoryShift,
} from "./ruled";

// USD is the ledger's storage currency; formatMoney converts to the user's
// display currency (or degrades to USD when no rates are cached). These views
// are client components for exactly that reason — the display currency and
// privacy mode live in client module state.
const money = (v: number) => formatMoney(v, "USD");

export type { CategoryShift } from "./ruled";

export type CategoryVsAverage = CategorySpend & {
  /** Per-period average over the comparison windows before this one. */
  average: number;
  /** total/average − 1, or null when there's no baseline. */
  delta: number | null;
};

/** The headline figure for the chosen period — shared by the category and trends views. */
export function SpendingHero({
  label,
  totals,
  topVendor,
  progress,
  aside,
}: {
  label: string;
  totals: PeriodTotals;
  topVendor?: TopMerchant;
  /** How far through the period today is, when the period is still running. */
  progress?: { elapsed: number; total: number } | null;
  /** The chart that sits beside the figure on wide screens. */
  aside?: React.ReactNode;
}) {
  const empty = totals.txCount === 0;
  if (empty) {
    return (
      <section className="rise space-y-3" aria-label={`${label} spending`}>
        <p className="eyebrow">{label}</p>
        <p className="text-[var(--muted)]">
          Nothing recorded for {label} yet. Sync or pick another period above.
        </p>
      </section>
    );
  }

  const verdict = spendingVerdict(totals);
  return (
    // One figure on the canvas, the sentence that reads it against income, then
    // the figures it is made of on a single rule — with the period's daily
    // chart beside it rather than a screen below.
    <section className="rise flex flex-wrap items-stretch gap-10" aria-label={`${label} spending`}>
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
        <Hero
          eyebrow={`Spent · ${label}`}
          figure={money(totals.expenses)}
          verdict={
            verdict && (
              <>
                {verdict.lead} <Mark tone={verdict.tone}>{money(verdict.amount)}</Mark>{" "}
                {verdict.tail}
              </>
            )
          }
        >
          {topVendor && (
            <p className="max-w-[60ch] text-sm text-[var(--muted)]">
              Your top vendor was{" "}
              <span className="font-medium text-[var(--paper)]">{topVendor.vendor}</span> at{" "}
              <span className="mono text-[var(--paper)]">{money(topVendor.total)}</span> over{" "}
              {topVendor.count} visit{topVendor.count === 1 ? "" : "s"}.
            </p>
          )}
        </Hero>
        <StatStrip className="mt-auto">
          <Stat label="Income" value={money(totals.income)} tone="jade" />
          <Stat
            label="Net"
            value={`${totals.net >= 0 ? "+" : "−"}${money(Math.abs(totals.net))}`}
            tone={totals.net >= 0 ? "jade" : "coral"}
          />
          <Stat label="Transactions" value={totals.txCount.toLocaleString()} />
          {progress && (
            <Stat
              label="Period is"
              value={`${progress.elapsed} of ${progress.total} days in`}
            />
          )}
        </StatStrip>
      </div>
      {aside && <div className="min-w-0 flex-[1.4_1_420px]">{aside}</div>}
    </section>
  );
}

// ── By category ───────────────────────────────────────────────────────────────

const CAT_GRID =
  "grid grid-cols-[minmax(150px,1.2fr)_minmax(120px,1.4fr)_100px_60px_92px_110px] items-center gap-[18px]";

/**
 * The selected category (?category=): its own figure and breakdown, in place
 * of the period hero — a deep link lands on it without scrolling, and it works
 * for categories with no spend in the period on screen.
 */
export function CategoryFocus({
  selected,
  explicitPeriod,
  allCategories,
}: {
  selected: CategoryDetail;
  explicitPeriod?: string;
  allCategories: CategoryRow[];
}) {
  const closeHref = spendingHref({ period: explicitPeriod });
  const inflowLed = selected.group !== "spending" && selected.received > selected.spent;
  const color = allCategories.find((c) => c.id === selected.id)?.color;

  return (
    <section className="rise space-y-6" aria-label={selected.name}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={closeHref}
          scroll={false}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
        >
          <ArrowLeft size={16} aria-hidden /> Categories
        </Link>
        <div className="flex flex-wrap gap-2">
          {selected.group === "spending" && !selected.archived && (
            <Link href={`/budgets?c=${encodeURIComponent(selected.id)}`} className={quietPill}>
              Budget
            </Link>
          )}
          <Link href="/settings#categories" className={quietPill}>
            Rename or archive
          </Link>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3.5">
        <p className="eyebrow flex flex-wrap items-center gap-2.5">
          <CategoryDot id={selected.id} color={color} />
          {selected.name} · {inflowLed ? "received" : "spent"}, all time
          {selected.archived && (
            <span className="rounded-md border border-line px-2 py-0.5 text-[11px] normal-case tracking-normal text-[var(--muted)]">
              Archived
            </span>
          )}
        </p>
        <p className="display-1 font-display text-5xl tabular sm:text-6xl">
          <Figure value={money(inflowLed ? selected.received : selected.spent)} />
        </p>
        <p className="text-sm text-[var(--muted)]">
          Across {selected.count.toLocaleString()} transaction{selected.count === 1 ? "" : "s"}
          {!inflowLed && selected.received > 0.005 && (
            <>
              , with <span className="mono text-[var(--paper)]">{money(selected.received)}</span>{" "}
              refunded or received
            </>
          )}
          .
        </p>
      </div>

      <CategoryDetailPanel
        key={selected.id}
        categoryId={selected.id}
        categories={allCategories}
        group={selected.group}
      />
    </section>
  );
}

export function CategoryView({
  label,
  averageLabel,
  explicitPeriod,
  rows,
  allCategories,
  selectedId,
  topVendors,
  biggest,
  insights,
}: {
  label: string;
  /** What the average is taken over, e.g. "3-month average". */
  averageLabel: string;
  explicitPeriod?: string;
  rows: CategoryVsAverage[];
  allCategories: CategoryRow[];
  selectedId?: string | null;
  topVendors: TopMerchant[];
  biggest: BiggestPurchase[];
  /** The alerts list, rendered by the page (it is a shared component). */
  insights?: React.ReactNode;
}) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const colorOf = new Map(allCategories.map((c) => [c.id, c.color]));

  return (
    <div className="flex flex-wrap gap-x-12 gap-y-9">
      <section aria-label="Categories" className="min-w-0 flex-[3_1_560px]">
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div
              className={`${CAT_GRID} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
            >
              <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
                Where it went
              </h2>
              <span>Share of spending</span>
              <span className="text-right">Spent</span>
              <span className="text-right">Share</span>
              <span className="text-right">vs. average</span>
              <span className="text-right">{averageLabel}</span>
            </div>
            {rows.map((r) => {
              const key = r.categoryId ?? r.category;
              const color = r.categoryId ? colorOf.get(r.categoryId) : null;
              const share = total > 0 ? (r.total / total) * 100 : 0;
              const active = r.categoryId != null && r.categoryId === selectedId;
              const cells = (
                <>
                  <span className="flex min-w-0 items-center gap-2.5 font-medium">
                    <CategoryDot id={key} color={color} />
                    <span className="truncate">{r.category}</span>
                  </span>
                  <ShareBar pct={share} id={key} color={color} />
                  <span className="mono text-right tabular">{money(r.total)}</span>
                  <span className="mono text-right text-xs text-[var(--muted)]">
                    {share >= 10 || share === 0 ? share.toFixed(0) : share.toFixed(1)}%
                  </span>
                  <Delta row={r} />
                  <span className="mono text-right text-[13px] text-[var(--muted)]">
                    {r.average > 0 ? money(r.average) : "—"}
                  </span>
                </>
              );
              const rowClass = `${CAT_GRID} min-h-14 border-b border-line text-sm`;
              // Uncategorized has no id to open — it's a row, not a link.
              return r.categoryId ? (
                <Link
                  key={key}
                  href={spendingHref({ period: explicitPeriod, category: r.categoryId })}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={`${rowClass} transition-colors hover:bg-[var(--panel)] ${
                    active ? "bg-[var(--panel)]" : ""
                  }`}
                >
                  {cells}
                </Link>
              ) : (
                <div key={key} className={rowClass}>
                  {cells}
                </div>
              );
            })}
            {rows.length > 0 ? (
              <div className={`${CAT_GRID} mono min-h-14 text-sm`}>
                <span className="font-sans text-[var(--muted)]">Total</span>
                <span />
                <span className="text-right tabular">{money(total)}</span>
                <span className="text-right text-xs text-[var(--muted)]">100%</span>
                <span />
                <span />
              </div>
            ) : (
              <Blank>No category spend in {label}.</Blank>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5 text-[13px] text-[var(--muted)]">
          <span>
            Open a category for its 12-month history and every transaction. Compared with the{" "}
            {averageLabel}.
          </span>
          <Link href="/settings#categories" className={quietPill}>
            Add or archive categories
          </Link>
        </div>
      </section>

      <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-9">
        <section aria-label="Top vendors">
          <SectionHead
            title="Top vendors"
            action={
              <Link
                href={spendingHref({ view: "vendor", period: explicitPeriod })}
                className="text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
              >
                All vendors · merge
              </Link>
            }
          />
          {topVendors.length > 0 ? (
            <ul>
              {topVendors.map((v) => (
                <RuledRow key={v.vendor} figure={money(v.total)}>
                  <span className="font-medium">{v.vendor}</span>
                  <span className="ml-2.5 text-xs text-[var(--muted)]">
                    {v.count} charge{v.count === 1 ? "" : "s"}
                  </span>
                </RuledRow>
              ))}
            </ul>
          ) : (
            <Blank>No vendor spend in this period.</Blank>
          )}
        </section>

        <section aria-label="Biggest purchases">
          <SectionHead title="Biggest purchases" />
          {biggest.length > 0 ? (
            <ul>
              {biggest.map((b) => (
                <RuledRow key={b.id} figure={money(b.amount)}>
                  <span className="mono mr-3 text-xs text-[var(--muted)]">
                    {format(parseISO(b.date), "MMM d")}
                  </span>
                  {b.vendor}
                  <span className="ml-2.5 text-xs text-[var(--muted)]">{b.categoryName}</span>
                </RuledRow>
              ))}
            </ul>
          ) : (
            <Blank>No purchases in this period.</Blank>
          )}
        </section>

        {insights}
      </div>
    </div>
  );
}

/**
 * How far the category sits from what it usually costs, in money. Inside ±5%
 * of its own average is "normal" — labelling that a change is noise.
 */
function Delta({ row }: { row: CategoryVsAverage }) {
  const base = "mono text-right text-[13px]";
  if (row.delta === null) {
    return <span className={`${base} text-[var(--muted)]`}>new</span>;
  }
  if (Math.abs(row.delta) < 0.05) {
    return <span className={`${base} text-[var(--muted)]`}>on average</span>;
  }
  const diff = row.total - row.average;
  const up = diff > 0;
  return (
    <span
      className={`${base} tabular ${up ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}
      title={`${up ? "+" : "−"}${Math.abs(Math.round(row.delta * 100))}% against the average`}
    >
      {up ? "+" : "−"}
      {money(Math.abs(diff))}
    </span>
  );
}

// ── Trends ────────────────────────────────────────────────────────────────────

export function TrendsView({
  label,
  prevLabel,
  topVendors,
  biggest,
  shifts,
  monthlySpend,
  year,
  periodSpend,
  periodStart,
  periodEnd,
  allCategories,
}: {
  label: string;
  prevLabel: string;
  topVendors: TopMerchant[];
  biggest: BiggestPurchase[];
  shifts: CategoryShift[];
  monthlySpend: { month: string; spent: number }[];
  year: number;
  periodSpend: { date: string; spent: number }[];
  periodStart: string;
  periodEnd: string;
  allCategories: CategoryRow[];
}) {
  return (
    <>
      <div className="flex flex-wrap gap-x-12 gap-y-9">
        {/* Month-by-month for the period's calendar year. */}
        <section className="min-w-0 flex-[1_1_360px] space-y-4">
          <SectionHead title={`Month by month · ${year}`} />
          <MonthlySpendChart data={monthlySpend} />
        </section>

        {/* Daily spend — scoped to the selected period. */}
        <section className="min-w-0 flex-[1_1_360px] space-y-4">
          <SectionHead title={`Daily spend · ${label}`} />
          <PeriodSpendChart
            data={periodSpend}
            start={periodStart}
            end={periodEnd}
            label={label}
            categories={allCategories}
          />
        </section>
      </div>

      <ShiftsTable shifts={shifts} prevLabel={prevLabel} label={label} fmt={money} />

      {/* Top vendors + biggest purchases */}
      <div className="flex flex-wrap gap-x-10 gap-y-9">
        <section className="min-w-0 flex-[1_1_260px]">
          <SectionHead title="Top vendors" />
          {topVendors.length > 0 ? (
            <ul>
              {topVendors.map((v) => (
                <RuledRow key={v.vendor} figure={money(v.total)}>
                  <span className="font-medium">{v.vendor}</span>
                  <span className="ml-2.5 text-xs text-[var(--muted)]">
                    {v.count} charge{v.count === 1 ? "" : "s"}
                  </span>
                </RuledRow>
              ))}
            </ul>
          ) : (
            <Blank>No vendor spend in this period.</Blank>
          )}
        </section>

        <section className="min-w-0 flex-[1_1_260px]">
          <SectionHead title="Biggest purchases" />
          {biggest.length > 0 ? (
            <ul>
              {biggest.map((b) => (
                <RuledRow key={b.id} figure={money(b.amount)}>
                  <span className="mono mr-3 text-xs text-[var(--muted)]">
                    {format(parseISO(b.date), "MMM d")}
                  </span>
                  {b.vendor}
                  <span className="ml-2.5 text-xs text-[var(--muted)]">{b.categoryName}</span>
                </RuledRow>
              ))}
            </ul>
          ) : (
            <Blank>No purchases in this period.</Blank>
          )}
        </section>
      </div>
    </>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-[var(--muted)]">{children}</p>;
}
