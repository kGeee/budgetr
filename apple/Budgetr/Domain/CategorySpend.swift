import Foundation

/// Month-to-date spend grouped by resolved category id.
///
/// Every screen that attributes spending to a category — Dashboard, Categories,
/// Budgets — must resolve overrides and Plaid-primary fallbacks the same way,
/// and must skip the transfer group (including Reimbursable). This is that
/// resolution, extracted so tests can pin it and views can't drift.
enum CategorySpend {

    struct Line {
        let amount: Double
        let date: String
        let userCategoryId: String?
        let plaidPrimary: String?
    }

    /// Outflows in `month` (`YYYY-MM`), keyed by resolved category id.
    /// Unmapped rows land in `"__none__"`. Transfer-group categories and
    /// unmapped transfer Plaid primaries are omitted.
    static func totals(
        lines: [Line],
        month: String,
        plaidPrimaryToCategoryId: [String: String],
        categoryGroupById: [String: String] = [:]
    ) -> [String: Double] {
        var out: [String: Double] = [:]
        for line in lines where line.date.hasPrefix(month) && line.amount > 0 {
            let id = CategoryMapping.resolvedCategoryId(
                userCategoryId: line.userCategoryId,
                plaidPrimary: line.plaidPrimary,
                categoryIdForPlaidPrimary: { plaidPrimaryToCategoryId[$0] }
            )
            let group = id.flatMap { categoryGroupById[$0] }
            guard CategoryMapping.countsTowardSpend(
                resolvedGroup: group,
                plaidPrimary: line.plaidPrimary
            ) else { continue }

            let key = id ?? "__none__"
            out[key, default: 0] += line.amount
        }
        return out
    }

    /// Lines that count as spend (transfers / reimbursable dropped).
    static func spendLines(
        _ lines: [Line],
        plaidPrimaryToCategoryId: [String: String],
        categoryGroupById: [String: String]
    ) -> [Line] {
        lines.filter { line in
            let id = CategoryMapping.resolvedCategoryId(
                userCategoryId: line.userCategoryId,
                plaidPrimary: line.plaidPrimary,
                categoryIdForPlaidPrimary: { plaidPrimaryToCategoryId[$0] }
            )
            let group = id.flatMap { categoryGroupById[$0] }
            return CategoryMapping.countsTowardSpend(
                resolvedGroup: group,
                plaidPrimary: line.plaidPrimary
            )
        }
    }

    static func spent(for categoryId: String, in totals: [String: Double]) -> Double {
        totals[categoryId] ?? 0
    }
}

/// Budget utilisation state — matches the web / Expo companion semantics.
enum BudgetUtilisation {
    case ok, warn, over

    /// `warn` at ~85% of limit; `over` at or above 100%.
    static func classify(spent: Double, limit: Double) -> BudgetUtilisation {
        guard limit > 0 else { return .ok }
        let ratio = spent / limit
        if ratio >= 1 { return .over }
        if ratio >= 0.85 { return .warn }
        return .ok
    }

    /// `1.3×` / `10×` — how far past the limit spend has gone.
    static func multiplierLabel(spent: Double, limit: Double) -> String? {
        guard limit > 0, spent > limit else { return nil }
        let ratio = spent / limit
        if ratio >= 10 {
            return String(format: "%.0f×", ratio)
        }
        return String(format: "%.1f×", ratio)
    }
}
