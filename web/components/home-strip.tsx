import Link from "next/link";
import { Figure } from "@/components/ui/statement";
import { longDate } from "@/components/transactions/ledger-bits";
import { paceState, type MonthPace, type PortfolioTotals } from "@/lib/home-layout";
import type { BudgetSummary, RecurringRow } from "@/lib/queries";
import { streamLabel } from "@/lib/recurring";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * Home's "this month" rule: three figures between the net-worth hero and the
 * columns — what's left to spend, what the portfolio is worth, and the next
 * bill — each a link to the page that owns it.
 */
export function ThisMonthStrip({
  budget,
  pace,
  portfolio,
  nextBill,
}: {
  budget: BudgetSummary;
  pace: MonthPace;
  portfolio: PortfolioTotals;
  /** The soonest predicted outflow, if one is on the horizon. */
  nextBill: RecurringRow | null;
}) {
  const state = paceState(budget.totalBudget, budget.totalSpent, pace.elapsed);
  const over = budget.left < 0;
  const days =
    pace.daysLeft > 0
      ? `${pace.daysLeft} ${pace.daysLeft === 1 ? "day" : "days"} left`
      : "month finished";
  const paceLine = {
    none: "Set monthly limits to track against plan",
    "over-budget": `Past what was budgeted · ${days}`,
    "over-pace": `Spending is ahead of pace · ${days}`,
    "under-pace": `Spending is under pace · ${days}`,
    "on-pace": `Spending is on pace · ${days}`,
  }[state];

  const up = (portfolio.gain ?? 0) >= 0;

  return (
    <section aria-label="This month" className="flex flex-wrap border-y border-line">
      <Cell
        href="/budgets"
        label={over ? "Over budget" : "Left to spend"}
        figure={state === "none" ? "No budgets" : formatCurrency(Math.abs(budget.left))}
        tone={over ? "text-[var(--coral)]" : undefined}
        sub={paceLine}
      />
      <Cell
        href="/investments"
        label="Portfolio"
        figure={portfolio.count > 0 ? formatCurrency(portfolio.value) : "No holdings"}
        sub={
          portfolio.count === 0 ? (
            "Link a brokerage to follow it here"
          ) : portfolio.gain == null || portfolio.gainPct == null ? (
            `${portfolio.count} ${portfolio.count === 1 ? "holding" : "holdings"}`
          ) : (
            <>
              <span className={`mono ${up ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}>
                {up ? "+" : "−"}
                {formatCurrency(Math.abs(portfolio.gain))} ({up ? "+" : "−"}
                {Math.abs(portfolio.gainPct).toFixed(2)}%)
              </span>{" "}
              against cost
            </>
          )
        }
      />
      <Cell
        href="/plan?tab=bills"
        label="Next bill"
        figure={
          nextBill
            ? formatCurrency(Math.abs(nextBill.averageAmount ?? 0), nextBill.currency ?? "USD")
            : "None due"
        }
        sub={
          nextBill
            ? `${streamLabel(nextBill).name}${
                nextBill.predictedNextDate ? ` · ${longDate(nextBill.predictedNextDate)}` : ""
              }`
            : "No bills predicted in the next month"
        }
      />
    </section>
  );
}

function Cell({
  href,
  label,
  figure,
  sub,
  tone,
}: {
  href: string;
  label: string;
  figure: string;
  sub: React.ReactNode;
  tone?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-[1_1_240px] flex-col gap-1 border-t border-line py-5 first:border-t-0 sm:border-l sm:border-t-0 sm:px-6 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0"
    >
      <span className="eyebrow">{label}</span>
      <span
        className={cn(
          "font-display text-3xl tracking-tight tabular transition-colors group-hover:text-[var(--brass)]",
          tone,
        )}
      >
        <Figure value={figure} />
      </span>
      <span className="text-sm text-[var(--muted)]">{sub}</span>
    </Link>
  );
}
