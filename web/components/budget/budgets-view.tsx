"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Lock, Repeat, Tags, X } from "lucide-react";
import { CategoryDetailPanel } from "@/components/budget/category-detail-panel";
import { PaceChart } from "@/components/budget/pace-chart";
import { CategoryDot } from "@/components/spending/ruled";
import { Dialog, DialogBody, DialogHeader } from "@/components/ui/dialog";
import { Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import { setBudget, setBudgetFixed, setBudgetRollover, setTagBudget } from "@/lib/actions";
import { budgetStatus, budgetVerdict, paceSeries } from "@/lib/budget-verdict";
import { cn, formatCurrency } from "@/lib/utils";
import type { BudgetRow, CategoryRow, EnvelopeBudgetRow } from "@/lib/queries";

/**
 * The Budgets page body — the month's headline beside its pace chart, then one
 * ruled table of every budget, grouped Fixed and Flexible.
 *
 * Navigation hinges on *focus*: selecting a row re-scopes the pace chart to that
 * category and opens its breakdown under the table, so "how is Groceries doing"
 * is one click. Focus lives in client state (instant — the per-category daily
 * spend is already on the page) and is mirrored into `?c=` so the view survives
 * a reload and can be linked.
 *
 * Fixed budgets (rent, a loan payment) are read as paid or not and left out of
 * the pace; with none flagged, everything is judged as one month, as before.
 */

type EnvelopeRow = BudgetRow & Partial<Omit<EnvelopeBudgetRow, keyof BudgetRow>>;

export type DaySpend = { categoryId: string; date: string; spent: number };

// One column set for every group, so figures line up down the whole table.
const GRID =
  "grid grid-cols-[minmax(150px,1.2fr)_minmax(180px,2fr)_104px_104px_110px_96px] gap-5";

const PILL =
  "inline-flex min-h-11 cursor-pointer items-center rounded-full border border-[var(--line-strong)] px-4 text-sm text-[var(--paper)] transition-colors duration-200 hover:bg-[var(--panel)]";

const STATUS_TEXT = {
  jade: "text-[var(--jade)]",
  brass: "text-[var(--brass)]",
  coral: "text-[var(--coral)]",
  muted: "text-[var(--muted)]",
} as const;

const STATUS_FILL = {
  jade: "bg-[var(--jade)]",
  brass: "bg-[var(--brass)]",
  coral: "bg-[var(--coral)]",
  muted: "bg-[var(--jade)]",
} as const;

/** Local date, not UTC — "today" is the reader's day. */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const hasLimit = (r: BudgetRow) => r.budget != null && r.budget > 0;

export function BudgetsView({
  month,
  monthLabel,
  totalBudget,
  totalSpent,
  left,
  carriedForward,
  hasRollovers,
  envelopes,
  tags,
  spendByCategoryDay,
  categories,
}: {
  month: string; // YYYY-MM
  monthLabel: string;
  totalBudget: number;
  totalSpent: number;
  left: number;
  carriedForward: number;
  hasRollovers: boolean;
  envelopes: EnvelopeRow[];
  tags: BudgetRow[];
  spendByCategoryDay: DaySpend[];
  categories: CategoryRow[];
}) {
  // Seeded from the querystring (so a linked/reloaded view lands focused) but
  // owned by React from then on — the URL is written back imperatively below.
  const searchParams = useSearchParams();
  const [focus, setFocusState] = useState<string | null>(() => searchParams.get("c"));
  const [showIdle, setShowIdle] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [today] = useState(localToday);

  function setFocus(id: string | null) {
    setFocusState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    // Native history update — Next.js keeps this out of the RSC round-trip, so
    // focusing a row stays instant.
    window.history.replaceState(null, "", url);
  }
  const toggleFocus = (id: string) => setFocus(focus === id ? null : id);

  const budgeted = envelopes.filter(hasLimit);
  const fixed = budgeted.filter((r) => r.fixed);
  const flexible = budgeted.filter((r) => !r.fixed);
  // No limit set. Ones with spend are worth seeing (they're leaking money
  // somewhere unplanned); the rest stay behind a disclosure.
  const unbudgeted = envelopes.filter((r) => !hasLimit(r));
  const unbudgetedSpending = unbudgeted.filter((r) => r.spent > 0.01);
  const unbudgetedIdle = unbudgeted.filter((r) => r.spent <= 0.01);

  const fixedBudget = fixed.reduce((s, r) => s + (r.budget ?? 0), 0);
  const fixedSpent = fixed.reduce((s, r) => s + r.spent, 0);
  const flexibleBudget = totalBudget - fixedBudget;
  const hasFixed = fixed.length > 0;

  const focused = focus ? (envelopes.find((r) => r.categoryId === focus) ?? null) : null;

  // Share of the month gone — where the tick sits on every flexible bar.
  const [yy, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const current = today.slice(0, 7) === month;
  const elapsed = current ? Math.min(1, Math.max(1, Number(today.slice(8, 10))) / daysInMonth) : 1;

  const rolloverCount = budgeted.filter((r) => r.rollover).length;
  const rowProps = { elapsed, current, editing, setEditing };

  return (
    <div className="space-y-9">
      <section
        className="rise flex flex-wrap items-stretch gap-10"
        aria-label={`${monthLabel} budget`}
      >
        <Summary
          month={month}
          monthLabel={monthLabel}
          today={today}
          totalBudget={totalBudget}
          totalSpent={totalSpent}
          left={left}
          fixedBudget={fixedBudget}
          fixedSpent={fixedSpent}
          hasFixed={hasFixed}
          carriedForward={carriedForward}
          hasRollovers={hasRollovers}
        />
        <Pace
          month={month}
          today={today}
          totalBudget={totalBudget}
          flexibleBudget={flexibleBudget}
          fixedIds={fixed.map((r) => r.categoryId)}
          spendByCategoryDay={spendByCategoryDay}
          focused={focused}
          onClearFocus={() => setFocus(null)}
        />
      </section>

      <section aria-label="Budget categories">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {budgeted.length === 0 && (
              <>
                <GroupHead title="Budgets" columns />
                <p className="border-b border-line py-6 text-sm text-[var(--muted)]">
                  No budgets set yet. Give a category a monthly limit below and it gets a pace
                  line, a status, and a warning before you run it dry.
                </p>
              </>
            )}

            {hasFixed && (
              <>
                <GroupHead title="Fixed" count={fixed.length} columns />
                {fixed.map((row) => (
                  <Row
                    key={row.categoryId}
                    row={row}
                    focused={focus === row.categoryId}
                    onFocus={() => toggleFocus(row.categoryId)}
                    {...rowProps}
                  />
                ))}
              </>
            )}

            {flexible.length > 0 && (
              <>
                <GroupHead
                  title={hasFixed ? "Flexible" : "Budgets"}
                  count={flexible.length}
                  columns={!hasFixed}
                  spaced={hasFixed}
                />
                {flexible.map((row) => (
                  <Row
                    key={row.categoryId}
                    row={row}
                    focused={focus === row.categoryId}
                    onFocus={() => toggleFocus(row.categoryId)}
                    {...rowProps}
                  />
                ))}
              </>
            )}

            {budgeted.length > 0 && (
              <div className={cn(GRID, "mono min-h-14 items-center text-sm")}>
                <span className="font-sans text-[var(--muted)]">Total</span>
                <span />
                <span className="text-right">{formatCurrency(totalSpent)}</span>
                <span className="text-right">{formatCurrency(totalBudget)}</span>
                <span
                  className={cn("text-right", left < 0 ? "text-[var(--coral)]" : "text-[var(--jade)]")}
                >
                  {left < 0 ? "−" : ""}
                  {formatCurrency(Math.abs(left))}
                </span>
                <span />
              </div>
            )}

            {/* Categories with no limit. Spending ones first — money going
                somewhere unplanned is more interesting than a dormant category. */}
            {unbudgeted.length > 0 && (
              <>
                <GroupHead
                  title="No budget"
                  count={unbudgeted.length}
                  spaced={budgeted.length > 0}
                  note="spending with no limit set"
                />
                {unbudgetedSpending.map((row) => (
                  <Row
                    key={row.categoryId}
                    row={row}
                    focused={focus === row.categoryId}
                    onFocus={() => toggleFocus(row.categoryId)}
                    {...rowProps}
                  />
                ))}
                {unbudgetedIdle.length > 0 && (
                  <>
                    <div className="flex min-h-11 items-center border-b border-line">
                      <button
                        type="button"
                        onClick={() => setShowIdle((v) => !v)}
                        aria-expanded={showIdle}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] text-[var(--muted)] transition-colors duration-200 hover:text-[var(--paper)]"
                      >
                        <ChevronDown
                          size={13}
                          aria-hidden
                          className={cn("transition-transform duration-200", showIdle && "rotate-180")}
                        />
                        No spend this month · {unbudgetedIdle.length}
                      </button>
                    </div>
                    {showIdle &&
                      unbudgetedIdle.map((row) => (
                        <Row
                          key={row.categoryId}
                          row={row}
                          focused={focus === row.categoryId}
                          onFocus={() => toggleFocus(row.categoryId)}
                          {...rowProps}
                        />
                      ))}
                  </>
                )}
              </>
            )}

            {tags.length > 0 && (
              <>
                <GroupHead
                  title="Tag budgets"
                  count={tags.length}
                  spaced
                  note="counts alongside categories"
                />
                {tags.map((row) => (
                  <Row key={row.categoryId} row={row} kind="tag" {...rowProps} />
                ))}
              </>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5 text-[13px] text-[var(--muted)]">
          <span className="max-w-[62ch]">
            Click any budget figure to change it
            {hasFixed ? "" : ", or to mark a bill like rent as fixed so it stays out of the pace"}.{" "}
            {budgeted.length > 0 &&
              (rolloverCount === 0
                ? "Rollover is off for every category."
                : `Rollover is on for ${rolloverCount} of ${budgeted.length} categor${budgeted.length === 1 ? "y" : "ies"}.`)}
          </span>
          <div className="flex flex-wrap gap-2">
            {budgeted.length > 0 && (
              <button type="button" onClick={() => setRolloverOpen(true)} className={PILL}>
                Rollover settings
              </button>
            )}
            <Link href="/settings#categories" className={PILL}>
              Add category
            </Link>
          </div>
        </div>
      </section>

      {focused && (
        <section aria-label={`${focused.name} breakdown`} className="rise">
          <SectionHead
            title={focused.name}
            count={`${formatCurrency(focused.spent)} spent${hasLimit(focused) ? ` of ${formatCurrency(focused.budget ?? 0)}` : ""} this month`}
            action={
              <button
                type="button"
                onClick={() => setFocus(null)}
                aria-label={`Close the ${focused.name} breakdown`}
                className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition-colors duration-200 hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
              >
                <X size={14} aria-hidden />
              </button>
            }
            className="items-center"
          />
          <CategoryDetailPanel
            categoryId={focused.categoryId}
            categories={categories}
            group="spending"
          />
        </section>
      )}

      {rolloverOpen && <RolloverDialog rows={budgeted} onClose={() => setRolloverOpen(false)} />}
    </div>
  );
}

// ── Headline ─────────────────────────────────────────────────────────────────

function Of({ spent, budget }: { spent: number; budget: number }) {
  return (
    <>
      {formatCurrency(spent)} <span className="text-[var(--muted)]">of {formatCurrency(budget)}</span>
    </>
  );
}

function Summary({
  month,
  monthLabel,
  today,
  totalBudget,
  totalSpent,
  left,
  fixedBudget,
  fixedSpent,
  hasFixed,
  carriedForward,
  hasRollovers,
}: {
  month: string;
  monthLabel: string;
  today: string;
  totalBudget: number;
  totalSpent: number;
  left: number;
  fixedBudget: number;
  fixedSpent: number;
  hasFixed: boolean;
  carriedForward: number;
  hasRollovers: boolean;
}) {
  const over = left < 0;
  const verdict = budgetVerdict({ month, today, totalBudget, totalSpent, fixedBudget, fixedSpent });
  const showCarry = hasRollovers && Math.abs(carriedForward) > 0.01;

  return (
    // The page's one editorial number sits on the canvas, not in a card: the
    // figure, a sentence that reads it, then the figures it is made of on one
    // rule pinned to the foot of the column so it lines up with the chart's axis.
    <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3.5">
      <Hero
        eyebrow={`${over ? "Over budget" : "Left to spend"} · ${monthLabel}`}
        figure={formatCurrency(Math.abs(left))}
        tone={over ? "coral" : "default"}
        verdict={
          verdict && (
            <span suppressHydrationWarning>
              {verdict.lead} <Mark tone={verdict.tone}>{formatCurrency(verdict.amount)}</Mark>{" "}
              {verdict.tail}
              {verdict.projectedOver != null && verdict.projectedOver > 0.005 && (
                <>
                  {" "}
                  At this rate {verdict.scope === "flexible" ? "it" : "the month"} ends{" "}
                  <Mark tone="brass">{formatCurrency(verdict.projectedOver)}</Mark> over.
                </>
              )}
              {verdict.scope === "flexible" && (
                <>
                  {" "}
                  Fixed costs have taken {formatCurrency(fixedSpent)} of{" "}
                  {formatCurrency(fixedBudget)} and are left out of the pace.
                </>
              )}
            </span>
          )
        }
      />
      <StatStrip className="mt-auto">
        {hasFixed ? (
          <>
            <Stat label="Fixed" value={<Of spent={fixedSpent} budget={fixedBudget} />} />
            <Stat
              label="Flexible"
              value={<Of spent={totalSpent - fixedSpent} budget={totalBudget - fixedBudget} />}
            />
            <Stat label="Month total" value={<Of spent={totalSpent} budget={totalBudget} />} />
          </>
        ) : (
          <>
            <Stat label="Spent" value={formatCurrency(totalSpent)} />
            <Stat label="Budgeted" value={formatCurrency(totalBudget)} />
          </>
        )}
        {/* Silent when the envelopes happen to net to zero — "+$0.00 carried
            forward" is noise, not information. */}
        {showCarry && (
          <Stat
            label="Carried forward"
            tone={carriedForward < 0 ? "coral" : "jade"}
            value={`${carriedForward >= 0 ? "+" : "−"}${formatCurrency(Math.abs(carriedForward))}`}
            sub="from last month"
          />
        )}
      </StatStrip>
    </div>
  );
}

// ── Pace ─────────────────────────────────────────────────────────────────────

/**
 * Cumulative spend against an even burn of the budget. Follows focus: with a row
 * selected it charts that category against its own limit, which is the question
 * you asked by selecting it. Unfocused, it leaves fixed budgets out — one rent
 * charge on the 1st would otherwise put every month ahead of pace.
 */
function Pace({
  month,
  today,
  totalBudget,
  flexibleBudget,
  fixedIds,
  spendByCategoryDay,
  focused,
  onClearFocus,
}: {
  month: string;
  today: string;
  totalBudget: number;
  flexibleBudget: number;
  fixedIds: string[];
  spendByCategoryDay: DaySpend[];
  focused: EnvelopeRow | null;
  onClearFocus: () => void;
}) {
  // Same rule as the verdict: narrow to flexible only when some budget is fixed
  // and some is not.
  const flexibleOnly = !focused && fixedIds.length > 0 && flexibleBudget > 0.005;
  const budget = focused ? (focused.budget ?? 0) : flexibleOnly ? flexibleBudget : totalBudget;
  const focusId = focused?.categoryId ?? null;
  const fixedKey = fixedIds.join("|");

  const series = useMemo(() => {
    const skip = new Set(flexibleOnly ? fixedKey.split("|") : []);
    return paceSeries({
      month,
      today,
      budget,
      rows: spendByCategoryDay,
      include: focusId
        ? (id) => id === focusId
        : flexibleOnly
          ? (id) => !skip.has(id)
          : undefined,
    });
  }, [month, today, budget, spendByCategoryDay, focusId, flexibleOnly, fixedKey]);

  if (budget <= 0 && !focused) return null;

  const title = focused ? `${focused.name} pace` : flexibleOnly ? "Flexible pace" : "Spending pace";
  const { spentToDate, paceToDate, projected, aheadOfPace } = series;

  return (
    <div className="flex min-w-0 flex-[1.4_1_420px] flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="eyebrow">{title}</span>
          {focused && (
            <button
              type="button"
              onClick={onClearFocus}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-xs text-[var(--muted)] transition-colors duration-200 hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
            >
              All {fixedIds.length > 0 ? "flexible" : "budgets"}
              <X size={12} aria-hidden />
              <span className="sr-only">— clear the category focus</span>
            </button>
          )}
        </div>
        <span className="flex items-center gap-4 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "h-0.5 w-3.5",
                aheadOfPace && budget > 0 ? "bg-[var(--coral)]" : "bg-[var(--jade)]",
              )}
            />
            Spent
          </span>
          {budget > 0 && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-3.5 border-t-2 border-dashed border-[var(--muted)]" />
              Even pace
            </span>
          )}
        </span>
      </div>

      <PaceChart series={series} budget={budget} label={title} />

      <p className="text-xs text-[var(--muted)]" suppressHydrationWarning>
        {budget > 0 ? (
          <>
            <span className="mono text-[var(--paper)]">{formatCurrency(spentToDate)}</span> spent
            against <span className="mono">{formatCurrency(paceToDate)}</span> at an even pace ·
            projected <span className="mono">{formatCurrency(projected)}</span> of{" "}
            <span className="mono">{formatCurrency(budget)}</span>
          </>
        ) : (
          <>
            <span className="mono text-[var(--paper)]">{formatCurrency(spentToDate)}</span> spent so
            far · no limit set for {focused?.name}, so there&rsquo;s no pace to keep
          </>
        )}
      </p>
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

/** A group's display-face title on a strong rule; the first one carries the column labels. */
function GroupHead({
  title,
  count,
  columns = false,
  spaced = false,
  note,
  id,
}: {
  title: string;
  count?: number;
  columns?: boolean;
  spaced?: boolean;
  note?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        GRID,
        "items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]",
        spaced && "pt-8",
      )}
    >
      <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
        {title}
        {count != null && <span className="mono ml-2 text-xs text-[var(--muted)]">{count}</span>}
      </h2>
      {columns ? (
        <>
          <span>Progress · tick marks today</span>
          <span className="text-right">Spent</span>
          <span className="text-right">Budget</span>
          <span className="text-right">Left</span>
          <span />
        </>
      ) : (
        note && <span className="col-span-5">{note}</span>
      )}
    </div>
  );
}

function Row({
  row,
  kind = "category",
  focused = false,
  onFocus,
  elapsed,
  current,
  editing,
  setEditing,
}: {
  row: EnvelopeRow;
  kind?: "category" | "tag";
  focused?: boolean;
  onFocus?: () => void;
  elapsed: number;
  current: boolean;
  editing: string | null;
  setEditing: (key: string | null) => void;
}) {
  const key = `${kind}:${row.categoryId}`;
  const open = editing === key;
  const budget = row.budget ?? 0;
  const limited = budget > 0;
  const isFixed = kind === "category" && limited && (row.fixed ?? false);
  const remaining = budget - row.spent;
  const over = limited && remaining < -0.005;
  const status = budgetStatus({ spent: row.spent, budget, fixed: isFixed, elapsed });
  const pct = limited ? Math.max(0, Math.min(100, (row.spent / budget) * 100)) : 0;
  const rollover = kind === "category" && limited && (row.rollover ?? false);
  const carryIn = rollover ? (row.carryIn ?? 0) : 0;

  const identity = (
    <>
      {kind === "tag" ? (
        <Tags size={12} aria-hidden className="shrink-0 text-[var(--muted)]" />
      ) : (
        <CategoryDot id={row.categoryId} />
      )}
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate font-medium transition-colors duration-200",
            focused ? "text-[var(--brass)]" : onFocus && "group-hover:text-[var(--brass)]",
          )}
        >
          {row.name}
        </span>
        {rollover && (
          <span className="mono block truncate text-[11px] font-normal text-[var(--muted)]">
            rollover
            {Math.abs(carryIn) > 0.01 && (
              <>
                {" · "}
                <span className={carryIn < 0 ? "text-[var(--coral)]" : "text-[var(--jade)]"}>
                  {carryIn >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(carryIn))}
                </span>{" "}
                carried in
              </>
            )}
            {row.available != null && (
              <>
                {" · "}
                <span className={row.available < 0 ? "text-[var(--coral)]" : "text-[var(--paper)]"}>
                  {formatCurrency(row.available)}
                </span>{" "}
                available
              </>
            )}
          </span>
        )}
      </span>
    </>
  );

  return (
    <>
      <div className={cn(GRID, "min-h-14 items-center border-b border-line text-sm")}>
        {onFocus ? (
          // The name is the filter control — one click scopes the pace chart to
          // this category and opens its breakdown under the table.
          <button
            type="button"
            onClick={onFocus}
            aria-pressed={focused}
            title={focused ? "Clear focus" : `Chart ${row.name} and list its transactions`}
            className="group flex min-h-11 min-w-0 cursor-pointer items-center gap-2.5 text-left"
          >
            {identity}
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-2.5">{identity}</span>
        )}

        {limited ? (
          <div
            role="progressbar"
            aria-valuenow={Math.round((row.spent / budget) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${row.name}: ${formatCurrency(row.spent)} of ${formatCurrency(budget)} spent`}
            className="relative h-1 rounded-full bg-[var(--panel-2)]"
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out",
                STATUS_FILL[status?.tone ?? "jade"],
              )}
              style={{ width: `${Math.max(pct, row.spent > 0 ? 1.5 : 0)}%` }}
            />
            {/* Where an even burn would be today. Fixed bills have no pace, and
                a closed month has no today. */}
            {!isFixed && current && (
              <span
                aria-hidden
                suppressHydrationWarning
                className="absolute -top-1 h-3 w-px bg-[var(--paper)]"
                style={{ left: `${(elapsed * 100).toFixed(1)}%` }}
              />
            )}
          </div>
        ) : (
          <span />
        )}

        <span className="mono text-right">{formatCurrency(row.spent)}</span>

        <span className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing(open ? null : key)}
            aria-expanded={open}
            aria-label={
              limited
                ? `Edit ${row.name} budget, ${formatCurrency(budget)}`
                : `Set a budget for ${row.name}`
            }
            className={cn(
              "mono inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-b border-dashed border-[var(--line-strong)] text-right transition-colors duration-200 hover:border-[var(--brass)]",
              limited ? "text-[var(--paper)]" : "font-sans text-[13px] text-[var(--muted)] hover:text-[var(--paper)]",
            )}
          >
            {isFixed && <Lock size={11} aria-hidden className="text-[var(--brass)]" />}
            {limited ? formatCurrency(budget) : "Set"}
          </button>
        </span>

        <span className={cn("mono text-right", over && "text-[var(--coral)]")}>
          {limited ? (
            <>
              {over ? "−" : ""}
              {formatCurrency(Math.abs(remaining))}
            </>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          )}
        </span>

        <span
          className={cn("text-right text-xs", STATUS_TEXT[status?.tone ?? "muted"])}
          suppressHydrationWarning
        >
          {status?.label ?? (row.spent > 0.01 ? "No limit" : "")}
        </span>
      </div>

      {open && <Editor row={row} kind={kind} onDone={() => setEditing(null)} />}
    </>
  );
}

/**
 * The edit affordance behind a budget figure: the monthly limit, and — for a
 * category that has one — whether it is a fixed cost and whether it rolls over.
 * The two switches save on click; the amount saves with the form.
 */
function Editor({
  row,
  kind,
  onDone,
}: {
  row: EnvelopeRow;
  kind: "category" | "tag";
  onDone: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(row.budget != null ? String(row.budget) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const limited = row.budget != null && row.budget > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(value);
    const normalized = Number.isFinite(amount) && amount > 0 ? amount : 0;
    if (value.trim() !== "" && !Number.isFinite(amount)) {
      setError("Enter a number, or clear the field to remove the budget.");
      return;
    }
    start(async () => {
      // row.categoryId carries the tag id when kind === "tag".
      if (kind === "tag") await setTagBudget(row.categoryId, normalized);
      else await setBudget(row.categoryId, normalized);
      setError(null);
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-[var(--panel)] px-4 py-3">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label htmlFor={`budget-${kind}-${row.categoryId}`} className="text-[13px] text-[var(--muted)]">
          Monthly budget
        </label>
        <span className="mono text-sm text-[var(--muted)]">$</span>
        <input
          id={`budget-${kind}-${row.categoryId}`}
          value={value}
          inputMode="decimal"
          autoFocus
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
          onKeyDown={(e) => e.key === "Escape" && onDone()}
          placeholder="0"
          aria-describedby={`budget-hint-${kind}-${row.categoryId}`}
          className="mono h-11 w-28 rounded-lg border border-line bg-[var(--ink)] px-2.5 text-sm tabular outline-none transition-colors duration-200 focus:border-[var(--brass-dim)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--brass)] px-4 text-sm font-medium text-[var(--on-brass)] transition duration-200 hover:brightness-105 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
        >
          <Check size={13} aria-hidden /> {pending ? "Saving…" : "Save"}
        </button>
      </form>

      {kind === "category" && limited && (
        <div className="flex flex-wrap items-center gap-2">
          <FixedToggle row={row} />
          <RolloverToggle row={row} />
        </div>
      )}

      <p
        id={`budget-hint-${kind}-${row.categoryId}`}
        className="min-w-0 flex-1 text-xs text-[var(--muted)]"
      >
        {error ? (
          <span className="text-[var(--coral)]">{error}</span>
        ) : kind === "category" && limited ? (
          "Fixed is for bills that land in one charge, like rent: read as paid or not, and left out of the pace. Clear the amount to remove the budget."
        ) : (
          "Clear the amount to remove this budget."
        )}
      </p>

      <button
        type="button"
        onClick={onDone}
        aria-label={`Close the ${row.name} budget editor`}
        className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition-colors duration-200 hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

const SWITCH =
  "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200 disabled:cursor-default disabled:opacity-40";
const SWITCH_ON =
  "border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] text-[var(--brass)]";
const SWITCH_OFF =
  "border-line text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]";

/** Fixed cost: judged as paid or not, and left out of the spending pace. */
function FixedToggle({ row }: { row: EnvelopeRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const enabled = row.fixed ?? false;

  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          await setBudgetFixed(row.categoryId, !enabled);
          router.refresh();
        })
      }
      aria-pressed={enabled}
      disabled={pending}
      className={cn(SWITCH, enabled ? SWITCH_ON : SWITCH_OFF)}
    >
      <Lock size={12} aria-hidden />
      Fixed cost {enabled ? "on" : "off"}
    </button>
  );
}

/**
 * Envelope carry-over. On, an unspent balance rolls into next month and an
 * overspend eats into it — so the toggle only means anything once a limit exists.
 */
function RolloverToggle({ row }: { row: EnvelopeRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const enabled = row.rollover ?? false;

  if (row.budget == null) return null;

  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          await setBudgetRollover(row.categoryId, !enabled);
          router.refresh();
        })
      }
      aria-pressed={enabled}
      disabled={pending}
      className={cn(SWITCH, enabled ? SWITCH_ON : SWITCH_OFF)}
    >
      <Repeat size={12} aria-hidden />
      Rollover {enabled ? "on" : "off"}
    </button>
  );
}

/** Every budget's rollover switch in one place, with what each has to carry. */
function RolloverDialog({ rows, onClose }: { rows: EnvelopeRow[]; onClose: () => void }) {
  return (
    <Dialog onClose={onClose} label="Rollover settings" size="md">
      <DialogHeader
        title="Rollover settings"
        description="With rollover on, what a category leaves unspent carries into next month, and an overspend eats into it."
        onClose={onClose}
      />
      <DialogBody className="py-2">
        <ul>
          {rows.map((row) => (
            <li
              key={row.categoryId}
              className="flex min-h-14 items-center justify-between gap-3 border-b border-line last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <CategoryDot id={row.categoryId} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  {row.rollover && row.available != null && (
                    <span className="mono block text-[11px] text-[var(--muted)]">
                      <span
                        className={row.available < 0 ? "text-[var(--coral)]" : "text-[var(--paper)]"}
                      >
                        {formatCurrency(row.available)}
                      </span>{" "}
                      available
                    </span>
                  )}
                </span>
              </span>
              <RolloverToggle row={row} />
            </li>
          ))}
        </ul>
      </DialogBody>
    </Dialog>
  );
}
