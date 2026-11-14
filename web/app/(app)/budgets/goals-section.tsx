import { SavingsGoals } from "@/components/budget/savings-goals";
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

  return (
    <section id="goals" aria-labelledby="goals-heading" className="scroll-mt-6 space-y-5">
      <h2 id="goals-heading" className="eyebrow">
        Goals
      </h2>
      <div className="flex flex-col gap-6 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Total earmarked</p>
          <p className="display-1 mt-2 font-display text-5xl tabular">
            {formatCurrency(totalSaved)}
          </p>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {totalTarget > 0
              ? `${formatCurrency(totalSaved)} of ${formatCurrency(totalTarget)} across ${
                  active.length
                } goal${active.length === 1 ? "" : "s"} · ${Math.round(pct)}%`
              : "Set a goal to start earmarking money."}
          </p>
        </div>
        {totalTarget > 0 && (
          <div className="w-full sm:w-64">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
              <div
                className="h-full rounded-full bg-[var(--jade)] transition-all"
                style={{ width: `${Math.max(pct, totalSaved > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <SavingsGoals goals={goals} />
    </section>
  );
}
