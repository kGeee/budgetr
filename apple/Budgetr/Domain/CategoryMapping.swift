import Foundation

/// Port of the category-resolution + transfer-filtering rules described in the
/// migration notes (see `web/lib/queries.ts` / sync set: clauses).
enum CategoryMapping {
    /// Plaid primary categories that represent transfers, excluded from
    /// income/expense reporting.
    static let transferPrimaries: Set<String> = [
        "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS",
    ]

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

    /// Whether a transaction counts toward income/expense reports.
    static func countsTowardCashflow(plaidPrimary: String?) -> Bool {
        guard let plaidPrimary else { return true }
        return !transferPrimaries.contains(plaidPrimary)
    }
}
