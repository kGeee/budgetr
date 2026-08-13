"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Pencil, Repeat, Tags, Wallet, X } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryIcon } from "@/components/budget/category-pill";
import { CategoryDetailPanel } from "@/components/budget/category-detail-panel";
import { BudgetPaceChart } from "@/components/charts";
import { setBudget, setBudgetRollover, setTagBudget } from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type { BudgetRow, CategoryRow, EnvelopeBudgetRow } from "@/lib/queries";

/**
 * The Budgets page body — the month's headline, the pace chart, an envelope card
 * per budgeted category, and one detail panel underneath.
 *
 * Built on the same idea as the Shared page: navigation hinges on *focus*.
 * Selecting an envelope re-scopes the pace chart to that category and opens its
 * breakdown below, so "how is Groceries doing" is one click rather than a chart
 * for everything and a separate expandable row. Focus lives in client state
 * (instant — the per-category daily spend is already on the page) and is
 * mirrored into `?c=` so the view survives a reload and can be linked.
 */

type EnvelopeRow = BudgetRow & Partial<Omit<EnvelopeBudgetRow, keyof BudgetRow>>;

export type DaySpend = { categoryId: string; date: string; spent: number };

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
  const [showUnbudgeted, setShowUnbudgeted] = useState(false);

  function setFocus(id: string | null) {
    setFocusState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    // Native history update — Next.js keeps this out of the RSC round-trip, so
    // focusing an envelope stays instant.
    window.history.replaceState(null, "", url);
  }

  const budgeted = envelopes.filter((r) => r.budget != null && r.budget > 0);
  // No limit set. Ones with spend are worth seeing (they're leaking money
  // somewhere unplanned); the rest stay behind a disclosure.
  const unbudgeted = envelopes.filter((r) => !(r.budget != null && r.budget > 0));
  const unbudgetedSpending = unbudgeted.filter((r) => r.spent > 0.01);
  const unbudgetedIdle = unbudgeted.filter((r) => r.spent <= 0.01);

  const focused = focus ? (envelopes.find((r) => r.categoryId === focus) ?? null) : null;

  return (
    <div className="space-y-7">
      <Summary
        monthLabel={monthLabel}
        totalBudget={totalBudget}
        totalSpent={totalSpent}
        left={left}
        carriedForward={carriedForward}
        hasRollovers={hasRollovers}
      />

      <PaceCard
        month={month}
        monthLabel={monthLabel}
        totalBudget={totalBudget}
        spendByCategoryDay={spendByCategoryDay}
        focused={focused}
        onClearFocus={() => setFocus(null)}
      />

      <section aria-labelledby="envelopes-heading">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2 id="envelopes-heading" className="eyebrow">
              Envelopes
            </h2>
            {budgeted.length > 0 && (
              <span className="text-xs text-[var(--faint)]">{budgeted.length}</span>
            )}
          </div>
          {budgeted.length > 0 && (
            <span className="text-xs text-[var(--faint)]">
              {formatCurrency(totalSpent)} of {formatCurrency(totalBudget)} used
            </span>
          )}
        </div>

        {budgeted.length === 0 ? (
          <EmptyState
            icon={<Wallet size={18} aria-hidden />}
            title="No budgets set yet"
            body="Give a category a monthly limit and it becomes an envelope — with a pace line, a carried-over balance, and a warning before you run it dry."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {budgeted.map((row, i) => (
              <EnvelopeCard
                key={row.categoryId}
                row={row}
                index={i}
                focused={focus === row.categoryId}
                onFocus={() => setFocus(focus === row.categoryId ? null : row.categoryId)}
              />
            ))}
          </div>
        )}

        {/* Categories with no limit. Spending ones first — an envelope you
            haven't drawn yet is more interesting than a dormant category. */}
        {unbudgetedSpending.length > 0 && (
          <UnbudgetedStrip
            className="mt-4"
            rows={unbudgetedSpending}
            focus={focus}
            onFocus={(id) => setFocus(focus === id ? null : id)}
          />
        )}

        {unbudgetedIdle.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowUnbudgeted((v) => !v)}
              aria-expanded={showUnbudgeted}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--faint)] transition-colors duration-200 hover:text-[var(--muted)]"
            >
              <ChevronDown
                size={13}
                aria-hidden
                className={`transition-transform duration-200 ${showUnbudgeted ? "rotate-180" : ""}`}
              />
              No spend this month · {unbudgetedIdle.length}
            </button>
            {showUnbudgeted && (
              <UnbudgetedStrip
                className="mt-3"
                rows={unbudgetedIdle}
                focus={focus}
                onFocus={(id) => setFocus(focus === id ? null : id)}
              />
            )}
          </div>
        )}
      </section>

      {focused && (
        <FocusDetail row={focused} categories={categories} onClear={() => setFocus(null)} />
      )}

      {tags.length > 0 && (
        <section aria-labelledby="tags-heading">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 id="tags-heading" className="eyebrow">
                Tag budgets
              </h2>
              <span className="text-xs text-[var(--faint)]">{tags.length}</span>
            </div>
            <span className="text-xs text-[var(--faint)]">counts alongside categories</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tags.map((row, i) => (
              <EnvelopeCard key={row.categoryId} row={row} index={i} kind="tag" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * The same fixed hue ring the Shared page gives people, here carrying category
 * identity: one colour per envelope, reused by its disc, its focus chip and its
 * bar so a category is recognisable before its name is read. Lightness and
 * saturation come from the theme (`.tint`), so one hue works on both canvases.
 */
const HUES = [152, 40, 208, 12, 268, 96, 330, 186];

function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

const DISC_SIZE = { sm: "h-6 w-6", md: "h-8 w-8", lg: "h-10 w-10" } as const;

/** Tinted category disc. Decorative — the name is always adjacent in the DOM. */
function Disc({
  row,
  size = "md",
  kind = "category",
}: {
  row: BudgetRow;
  size?: keyof typeof DISC_SIZE;
  kind?: "category" | "tag";
}) {
  return (
    <span
      aria-hidden
      style={{ "--tint-h": hueFor(row.categoryId) } as React.CSSProperties}
      className={`tint grid shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--tint)_38%,transparent)] bg-[color-mix(in_srgb,var(--tint)_15%,transparent)] text-[var(--tint)] ${DISC_SIZE[size]}`}
    >
      {kind === "tag" ? (
        <Tags size={size === "sm" ? 11 : 14} />
      ) : (
        <CategoryIcon icon={row.icon} size={size === "sm" ? 11 : 14} />
      )}
    </span>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-line px-6 py-10 text-center">
      <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full border border-line bg-[var(--panel)] text-[var(--faint)]">
        {icon}
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--muted)]">{body}</p>
    </div>
  );
}

/**
 * How far through an envelope the month's spend has eaten. Three tones rather
 * than two: jade while there's room, brass from four fifths on (the warning you
 * can still act on), coral once it's gone.
 */
function Meter({
  spent,
  budget,
  label,
}: {
  spent: number;
  budget: number;
  label: string;
}) {
  const raw = budget > 0 ? (spent / budget) * 100 : 0;
  const pct = Math.max(0, Math.min(100, raw));
  const tone = raw > 100 ? "var(--coral)" : raw >= 80 ? "var(--brass)" : "var(--jade)";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(raw)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]"
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(pct, budget > 0 && spent > 0 ? 2 : 0)}%`, background: tone }}
      />
    </div>
  );
}

// ── Headline ─────────────────────────────────────────────────────────────────

function Summary({
  monthLabel,
  totalBudget,
  totalSpent,
  left,
  carriedForward,
  hasRollovers,
}: {
  monthLabel: string;
  totalBudget: number;
  totalSpent: number;
  left: number;
  carriedForward: number;
  hasRollovers: boolean;
}) {
  const over = left < 0;
  return (
    <Card className="rise p-6">
      <p className="eyebrow">{over ? "Over budget" : "Left to spend"}</p>
      {/* The month's headline keeps the display face it has always had — this is
          the page's one editorial number; the per-envelope figures below stay
          mono so columns of money line up. */}
      <p
        className={`display-1 mt-2 font-display text-5xl tabular ${over ? "text-[var(--coral)]" : ""}`}
      >
        {formatCurrency(Math.abs(left))}
      </p>
      <p className="mt-3 text-sm text-[var(--muted)]">
        {formatCurrency(totalSpent)} spent of {formatCurrency(totalBudget)} budgeted · {monthLabel}
      </p>
      {/* Silent when the envelopes happen to net to zero — "+$0.00 carried
          forward" is noise, not information. */}
      {hasRollovers && Math.abs(carriedForward) > 0.01 && (
        <p className="mt-1 text-sm text-[var(--muted)]">
          <span className={carriedForward < 0 ? "text-[var(--coral)]" : "text-[var(--jade)]"}>
            {carriedForward >= 0 ? "+" : "−"}
            {formatCurrency(Math.abs(carriedForward))}
          </span>{" "}
          carried forward from last month
        </p>
      )}
      {totalBudget > 0 && (
        <Meter
          spent={totalSpent}
          budget={totalBudget}
          label={`${Math.round((totalSpent / totalBudget) * 100)}% of this month's budget spent`}
        />
      )}
    </Card>
  );
}

// ── Pace ─────────────────────────────────────────────────────────────────────

/**
 * Cumulative spend against an even burn of the budget. Follows focus: with an
 * envelope selected it charts that envelope against its own limit, which is the
 * question you actually asked by selecting it.
 */
function PaceCard({
  month,
  monthLabel,
  totalBudget,
  spendByCategoryDay,
  focused,
  onClearFocus,
}: {
  month: string;
  monthLabel: string;
  totalBudget: number;
  spendByCategoryDay: DaySpend[];
  focused: EnvelopeRow | null;
  onClearFocus: () => void;
}) {
  const budget = focused ? (focused.budget ?? 0) : totalBudget;

  const { data, spentToDate, paceToDate, projected, aheadOfPace } = useMemo(() => {
    const [yy, mm] = month.split("-").map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const isCurrentMonth = new Date().toISOString().slice(0, 7) === month;
    const lastActualDay = isCurrentMonth
      ? Math.min(new Date().getDate(), daysInMonth)
      : daysInMonth;

    const byDate = new Map<string, number>();
    for (const row of spendByCategoryDay) {
      if (focused && row.categoryId !== focused.categoryId) continue;
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.spent);
    }

    let cum = 0;
    const series: { date: string; spent: number | null; pace: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      cum += byDate.get(`${month}-${String(d).padStart(2, "0")}`) ?? 0;
      series.push({
        date: `${month}-${String(d).padStart(2, "0")}`,
        spent: d <= lastActualDay ? cum : null,
        pace: (budget * d) / daysInMonth,
      });
    }

    const spent = series[lastActualDay - 1]?.spent ?? 0;
    const pace = (budget * lastActualDay) / daysInMonth;
    return {
      data: series,
      spentToDate: spent,
      paceToDate: pace,
      projected: lastActualDay > 0 ? (spent / lastActualDay) * daysInMonth : 0,
      aheadOfPace: spent > pace,
    };
  }, [month, budget, spendByCategoryDay, focused]);

  if (budget <= 0 && !focused) return null;

  return (
    <Card className="rise p-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-6 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="eyebrow">Spending pace · {monthLabel}</span>
          {focused && (
            <button
              onClick={onClearFocus}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] py-1 pl-1 pr-2.5 text-xs text-[var(--brass)] transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--brass)_20%,transparent)]"
            >
              <Disc row={focused} size="sm" />
              {focused.name}
              <X size={12} aria-hidden />
              <span className="sr-only">Clear category filter</span>
            </button>
          )}
        </div>
        <span className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: aheadOfPace ? "var(--coral)" : "var(--jade)" }}
            />
            Spent
          </span>
          {budget > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-3 border-t border-dashed border-[var(--muted)]" />
              Budget pace
            </span>
          )}
        </span>
      </div>

      <div className="px-3 py-5 sm:px-5">
        <BudgetPaceChart data={data} over={aheadOfPace} />
      </div>

      <p className="border-t border-line px-6 py-3 text-xs text-[var(--muted)]">
        {budget > 0 ? (
          <>
            <span className={aheadOfPace ? "text-[var(--coral)]" : "text-[var(--jade)]"}>
              {aheadOfPace ? "Ahead of pace" : "On pace"}
            </span>{" "}
            · {formatCurrency(spentToDate)} spent vs {formatCurrency(paceToDate)} budgeted so far ·
            projected {formatCurrency(projected)} of {formatCurrency(budget)}
          </>
        ) : (
          <>
            {formatCurrency(spentToDate)} spent so far · no limit set for {focused?.name}, so
            there&rsquo;s no pace to keep
          </>
        )}
      </p>
    </Card>
  );
}

// ── Envelopes ────────────────────────────────────────────────────────────────

function EnvelopeCard({
  row,
  index,
  kind = "category",
  focused = false,
  onFocus,
}: {
  row: EnvelopeRow;
  index: number;
  kind?: "category" | "tag";
  focused?: boolean;
  onFocus?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const budget = row.budget ?? 0;
  const limited = budget > 0;
  const remaining = row.remaining ?? budget - row.spent;
  const over = limited && row.spent > budget;
  const rollover = kind === "category" && (row.rollover ?? false);

  return (
    <Card
      className={`rise flex flex-col p-5 transition-[border-color,box-shadow] duration-200 ${
        focused ? "border-[var(--brass)] shadow-[var(--elev-3)]" : ""
      }`}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        {onFocus ? (
          // The identity block is the filter control — one click scopes the pace
          // chart and opens this envelope's breakdown below.
          <button
            onClick={onFocus}
            aria-pressed={focused}
            className="group flex min-w-0 cursor-pointer items-center gap-3 text-left"
          >
            <Disc row={row} kind={kind} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium transition-colors duration-200 group-hover:text-[var(--brass)]">
                {row.name}
              </span>
              <span className="mono mt-0.5 block truncate text-xs text-[var(--muted)]">
                {limited ? `${formatCurrency(row.spent)} of ${formatCurrency(budget)}` : "no limit set"}
              </span>
            </span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-3">
            <Disc row={row} kind={kind} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{row.name}</span>
              <span className="mono mt-0.5 block truncate text-xs text-[var(--muted)]">
                {limited ? `${formatCurrency(row.spent)} of ${formatCurrency(budget)}` : "no limit set"}
              </span>
            </span>
          </span>
        )}

        <button
          onClick={() => setEditing((v) => !v)}
          aria-label={`Edit the ${row.name} budget`}
          aria-expanded={editing}
          title="Edit budget"
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--faint)] transition-colors duration-200 hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
        >
          <Pencil size={13} aria-hidden />
        </button>
      </div>

      {/* With no limit there is nothing left *of*, so the figure that means
          something is what the category actually spent. */}
      <p className={`mono mt-4 text-3xl tabular ${over ? "text-[var(--coral)]" : ""}`}>
        {formatCurrency(Math.abs(limited ? remaining : row.spent))}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {!limited ? "spent this month" : over ? "over budget" : "left this month"}
        {/* "346%" lands faster than "$1,037.73 of $300.00" — the ratio is the
            thing being judged, and it was only ever available as a division the
            reader had to do. */}
        {limited && (
          <>
            {" · "}
            <span className={over ? "text-[var(--coral)]" : ""}>
              {Math.round((row.spent / budget) * 100)}%
            </span>
          </>
        )}
        {rollover && row.carryIn != null && Math.abs(row.carryIn) > 0.01 && (
          <>
            {" · "}
            <span className={row.carryIn < 0 ? "text-[var(--coral)]" : "text-[var(--jade)]"}>
              {row.carryIn >= 0 ? "+" : "−"}
              {formatCurrency(Math.abs(row.carryIn))}
            </span>{" "}
            carried in
          </>
        )}
      </p>

      <Meter
        spent={row.spent}
        budget={budget}
        label={`${row.name}: ${formatCurrency(row.spent)} of ${formatCurrency(budget)} spent`}
      />

      <div className="mt-auto pt-4">
        {editing ? (
          <BudgetForm row={row} kind={kind} onDone={() => setEditing(false)} />
        ) : kind === "category" ? (
          <RolloverToggle row={row} />
        ) : null}
      </div>
    </Card>
  );
}

/** Set or clear this envelope's monthly limit. */
function BudgetForm({
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
    <form
      onSubmit={submit}
      className="space-y-2.5 rounded-xl border border-line bg-[color-mix(in_srgb,var(--ink)_50%,transparent)] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={`budget-${row.categoryId}`}
          className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]"
        >
          Monthly budget
        </label>
        <button
          type="button"
          onClick={onDone}
          aria-label={`Cancel editing the ${row.name} budget`}
          className="grid h-6 w-6 cursor-pointer place-items-center rounded-full text-[var(--faint)] transition-colors duration-200 hover:text-[var(--paper)]"
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="mono text-sm text-[var(--muted)]">$</span>
        <input
          id={`budget-${row.categoryId}`}
          value={value}
          inputMode="decimal"
          autoFocus
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          className="mono min-w-0 flex-1 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-2 text-sm tabular outline-none transition-colors duration-200 focus:border-[var(--brass-dim)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--brass)] px-3.5 py-2 text-xs font-medium text-[var(--on-brass)] transition duration-200 hover:brightness-105 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
        >
          <Check size={12} aria-hidden /> {pending ? "Saving…" : "Save"}
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--faint)]">
        {error ? (
          <span className="text-[var(--coral)]">{error}</span>
        ) : (
          "Clear the field to remove this budget."
        )}
      </p>
    </form>
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
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        onClick={() =>
          start(async () => {
            await setBudgetRollover(row.categoryId, !enabled);
            router.refresh();
          })
        }
        aria-pressed={enabled}
        disabled={pending}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-200 disabled:cursor-default disabled:opacity-40 ${
          enabled
            ? "border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] text-[var(--brass)]"
            : "border-line text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
        }`}
      >
        <Repeat size={12} aria-hidden />
        Rollover {enabled ? "on" : "off"}
      </button>
      {enabled && row.available != null && (
        <span className="mono text-xs text-[var(--muted)]">
          <span className={row.available < 0 ? "text-[var(--coral)]" : "text-[var(--paper)]"}>
            {formatCurrency(row.available)}
          </span>{" "}
          available
        </span>
      )}
    </div>
  );
}

/** Categories with no limit, at chip weight — present, but out of the way. */
function UnbudgetedStrip({
  rows,
  focus,
  onFocus,
  className = "",
}: {
  rows: EnvelopeRow[];
  focus: string | null;
  onFocus: (id: string) => void;
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {rows.map((r) => {
        const active = focus === r.categoryId;
        return (
          <li key={r.categoryId}>
            <button
              onClick={() => onFocus(r.categoryId)}
              aria-pressed={active}
              className={`flex cursor-pointer items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-xs transition-colors duration-200 ${
                active
                  ? "border-[var(--brass)] bg-[var(--panel-2)] text-[var(--paper)]"
                  : "border-line bg-[var(--panel)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
              }`}
            >
              <Disc row={r} size="sm" />
              {r.name}
              {/* Say which side of the ledger the figure is. A bare "$8.00" on
                  a chip is equally readable as a budget or as a spend, and
                  these rows have no budget at all. */}
              <span className="mono text-[var(--faint)]">
                {r.spent > 0.01 ? `${formatCurrency(r.spent)} spent` : "no budget"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The focused envelope's breakdown — twelve months of spend and its
 * transactions. Lazily loaded by CategoryDetailPanel, so nothing is fetched
 * until a category is actually selected.
 */
function FocusDetail({
  row,
  categories,
  onClear,
}: {
  row: EnvelopeRow;
  categories: CategoryRow[];
  onClear: () => void;
}) {
  const budget = row.budget ?? 0;
  return (
    <Card className="rise p-0">
      <CardHeader className="flex-wrap items-center px-5 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <Disc row={row} />
          <div className="min-w-0">
            <CardTitle className="truncate text-sm normal-case tracking-normal text-[var(--paper)]">
              {row.name}
            </CardTitle>
            <p className="mono mt-0.5 text-xs text-[var(--muted)]">
              {formatCurrency(row.spent)} spent
              {budget > 0 && ` of ${formatCurrency(budget)}`} this month
            </p>
          </div>
        </div>
        <button
          onClick={onClear}
          aria-label={`Close the ${row.name} breakdown`}
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--faint)] transition-colors duration-200 hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
        >
          <X size={14} aria-hidden />
        </button>
      </CardHeader>
      <CategoryDetailPanel categoryId={row.categoryId} categories={categories} group="spending" />
    </Card>
  );
}
