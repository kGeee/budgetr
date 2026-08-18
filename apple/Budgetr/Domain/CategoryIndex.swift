import CoreData
import Foundation

/// Resolves a transaction to the category it should be reported under, and to a
/// name a human recognises.
///
/// This exists because the answer is not stored on the transaction. A row
/// carries Plaid's own string (`FOOD_AND_DRINK`) and, only when the user has
/// overridden it, a relationship to a real category. The web app resolves the
/// two with `effectiveCatId`: the override wins, otherwise fall back to the
/// category whose `plaidPrimary` matches. Anything that groups by category has
/// to do the same, or overridden and un-overridden rows land in different
/// buckets for the same category — which is what "three separate Uncategorised
/// rows" looks like on a chart.
struct CategoryIndex {
    /// Category id → display name.
    private let names: [String: String]
    /// Plaid primary (`FOOD_AND_DRINK`) → category id.
    private let byPlaidPrimary: [String: String]

    init(categories: [CDCategory]) {
        var names: [String: String] = [:]
        var byPrimary: [String: String] = [:]
        for c in categories {
            guard let id = c.id else { continue }
            names[id] = c.name ?? id
            if let primary = c.plaidPrimary, !primary.isEmpty {
                byPrimary[primary] = id
            }
        }
        self.names = names
        self.byPlaidPrimary = byPrimary
    }

    /// The category id a transaction reports under, or nil when nothing maps.
    func resolvedId(userCategoryId: String?, plaidPrimary: String?) -> String? {
        CategoryMapping.resolvedCategoryId(
            userCategoryId: userCategoryId,
            plaidPrimary: plaidPrimary,
            categoryIdForPlaidPrimary: { byPlaidPrimary[$0] }
        )
    }

    func resolvedId(for txn: CDTransaction) -> String? {
        resolvedId(userCategoryId: txn.userCategory?.id, plaidPrimary: txn.category)
    }

    /// A name to show. Falls back to prettifying Plaid's shouty constant rather
    /// than rendering `FOOD_AND_DRINK` at the user, and only says
    /// "Uncategorised" when there is genuinely nothing.
    func displayName(for txn: CDTransaction) -> String {
        if let id = resolvedId(for: txn), let name = names[id] { return name }
        if let primary = txn.category, !primary.isEmpty { return CategoryMapping.humanise(primary) }
        return "Uncategorised"
    }

    func name(forId id: String) -> String { names[id] ?? CategoryMapping.humanise(id) }
}
