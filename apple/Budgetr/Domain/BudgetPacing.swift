import Foundation

/// Port of the budget-pace math in `web/app/budgets/page.tsx` (lines ~28–50).
///
/// Pure value type — no Core Data, no UI — so it can be unit-tested against
/// fixtures captured from the TS implementation to prove parity.
struct BudgetPacing {
    let totalBudget: Double
    let spentToDate: Double
    /// 1-based day of the month (e.g. the 12th → 12).
    let dayOfMonth: Int
    let daysInMonth: Int

    /// Where cumulative spend *should* be today if spending evenly:
    /// `(totalBudget * dayOfMonth) / daysInMonth`.
    var expectedToDate: Double {
        guard daysInMonth > 0 else { return 0 }
        return totalBudget * Double(dayOfMonth) / Double(daysInMonth)
    }

    /// Positive = over pace (spending too fast); negative = under pace.
    var paceDelta: Double { spentToDate - expectedToDate }

    var isAheadOfPace: Bool { paceDelta > 0 }

    /// Straight-line projection of month-end spend:
    /// `(spentToDate / daysToDate) * daysInMonth`.
    var projectedMonthEnd: Double {
        guard dayOfMonth > 0 else { return 0 }
        return (spentToDate / Double(dayOfMonth)) * Double(daysInMonth)
    }

    /// Projected spend as a fraction of budget (1.0 == exactly on budget).
    var projectedRatio: Double {
        guard totalBudget > 0 else { return 0 }
        return projectedMonthEnd / totalBudget
    }

    // Convenience for "today" using the current calendar.
    static func current(totalBudget: Double,
                        spentToDate: Double,
                        calendar: Calendar = .current,
                        now: Date = Date()) -> BudgetPacing {
        let day = calendar.component(.day, from: now)
        let range = calendar.range(of: .day, in: .month, for: now)
        let days = range?.count ?? 30
        return BudgetPacing(totalBudget: totalBudget,
                            spentToDate: spentToDate,
                            dayOfMonth: day,
                            daysInMonth: days)
    }
}
