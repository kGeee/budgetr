import Foundation

/// Port of the category-resolution + transfer-filtering rules described in the
/// migration notes (see `web/lib/queries.ts` / sync set: clauses).
enum CategoryMapping {
    /// Plaid primary categories that represent transfers, excluded from
    /// income/expense reporting.
    static let transferPrimaries: Set<String> = [
        "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS",
    ]

    /// Category `group` value for internal money movement — Transfer In/Out,
    /// Loan Payments, and Reimbursable (`cat_reimbursable`). Web spend queries
    /// skip `group = 'transfer'`; matching that keeps Overview/Budgets honest.
    static let transferGroup = "transfer"

    /// User override (`userCategoryId`) wins; otherwise fall back to the Plaid
    /// primary category. Returns the *category id* to attribute the txn to,
    /// or nil if it should map purely by Plaid primary (resolved upstream).
    static func resolvedCategoryId(userCategoryId: String?,
                                   plaidPrimary: String?,
                                   categoryIdForPlaidPrimary: (String) -> String?) -> String? {
        if let userCategoryId { return userCategoryId }
        guard let plaidPrimary else { return nil }
        return categoryIdForPlaidPrimary(plaidPrimary)
    }

    /// Whether a transaction counts toward income/expense reports, from the
    /// Plaid primary alone (no resolved category yet).
    static func countsTowardCashflow(plaidPrimary: String?) -> Bool {
        guard let plaidPrimary else { return true }
        return !transferPrimaries.contains(plaidPrimary)
    }

    /// Whether an outflow counts as *spend* — mirrors web's
    /// `(cat.group IS NULL OR cat.group != 'transfer')` plus the Plaid-primary
    /// fallback when nothing resolves.
    ///
    /// The resolved category's group wins: overriding a transfer into Dining
    /// counts; filing Dining as Reimbursable (transfer group) does not.
    static func countsTowardSpend(resolvedGroup: String?, plaidPrimary: String?) -> Bool {
        if let resolvedGroup {
            return resolvedGroup != transferGroup
        }
        return countsTowardCashflow(plaidPrimary: plaidPrimary)
    }

    /// `FOOD_AND_DRINK` → `Food and drink`. Plaid's constants are shouty and
    /// must never reach the user verbatim.
    static func humanise(_ raw: String) -> String {
        let words = raw.split(separator: "_").map { $0.lowercased() }
        guard let first = words.first else { return raw }
        return ([first.prefix(1).uppercased() + first.dropFirst()] + words.dropFirst())
            .joined(separator: " ")
    }
}
