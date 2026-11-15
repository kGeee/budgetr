import { AddGoalButton, SavingsGoals } from "@/components/budget/savings-goals";
import { Mark, SectionHead, Stat, StatStrip, Verdict } from "@/components/ui/statement";
import { goalsVerdict } from "@/lib/progress-verdict";
import { getSavingsGoals } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

/**
 * Savings goals, folded in from the old /goals page: envelopes say what this
 * month may spend, goals say what is being set aside — one place to plan both.
 * Anchored #goals so links can land straight on it.
 */
export function GoalsSection() {
  const goals = getSavingsGoals();
  const active = goals.filter((g) => !g.archived);
  const totalSaved = active.reduce((s, g) => s + g.saved, 0);
  const totalTarget = active.reduce((s, g) => s + g.targetAmount, 0);
  const pct = totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0;
  const verdict = goalsVerdict({ totalSaved, totalTarget, count: active.length });

  return (
    <section id="goals" aria-labelledby="goals-heading" className="scroll-mt-6 space-y-5">
      <SectionHead
        id="goals-heading"
        title="Goals"
        count={active.length}
        action={<AddGoalButton />}
      />
      {/* Budgets already has the page's one hero figure above, so the goals
          summary is a sentence and a ruled strip rather than a second hero. */}
      <Verdict className={verdict ? undefined : "text-[var(--muted)]"}>
        {verdict ? (
          <>
            {verdict.lead} <Mark tone={verdict.tone}>{formatCurrency(verdict.amount)}</Mark>{" "}
            {verdict.tail}
          </>
        ) : (
          "Set a goal to start earmarking money."
        )}
      </Verdict>
      {totalTarget > 0 && (
        <div
          className="h-1 max-w-[520px] overflow-hidden rounded-full bg-[var(--panel-2)]"
          role="img"
          aria-label={`${Math.round(pct)}% of goal targets earmarked`}
        >
          <div
            className="h-full rounded-full bg-[var(--jade)] transition-all"
            style={{ width: `${Math.max(pct, totalSaved > 0 ? 2 : 0)}%` }}
          />
        </div>
      )}
      <StatStrip>
        <Stat label="Total earmarked" value={formatCurrency(totalSaved)} />
        {totalTarget > 0 && (
          <>
            <Stat label="Target" value={formatCurrency(totalTarget)} />
            <Stat
              label="Progress"
              value={`${Math.round(pct)}%`}
              sub={`across ${active.length} goal${active.length === 1 ? "" : "s"}`}
            />
          </>
        )}
      </StatStrip>

      <SavingsGoals goals={goals} />
    </section>
  );
}
