import CoreData
import Foundation

/// Writes to transactions, in one place.
///
/// The migration plan maps `web/lib/actions.ts` to "repository methods on the
/// managed context", and this is that. Views call these instead of mutating
/// managed objects inline, so there is a single spot that knows the rules —
/// notably that categorising something also marks it reviewed, which is what
/// empties the review backlog and is easy to forget at a call site.
struct TransactionRepository {
    let context: NSManagedObjectContext

    /// Assign a category, or clear the override with `nil`.
    ///
    /// Clearing does not un-review: you looked at the row and made a decision,
    /// and having it reappear in the backlog because the decision was "Plaid had
    /// it right" would make the backlog impossible to empty.
    func setCategory(_ category: CDCategory?, on txn: CDTransaction) throws {
        txn.userCategory = category
        txn.reviewed = true
        try save()
    }

    /// Flip the reviewed flag by hand — for triaging without recategorising.
    func setReviewed(_ reviewed: Bool, on txn: CDTransaction) throws {
        txn.reviewed = reviewed
        try save()
    }

    func setNotes(_ notes: String?, on txn: CDTransaction) throws {
        txn.notes = (notes?.isEmpty ?? true) ? nil : notes
        try save()
    }

    /// Apply one category to every transaction from the same merchant.
    ///
    /// The bulk move that makes a backlog tractable: you categorise Whole Foods
    /// once rather than forty times. Scoped by merchant name because that is
    /// what the user recognises, and only over rows that don't already carry an
    /// override — a previous explicit decision outranks this one.
    @discardableResult
    func applyCategoryToMerchant(
        _ category: CDCategory,
        merchant: String,
        includeReviewed: Bool = false
    ) throws -> Int {
        let request = NSFetchRequest<CDTransaction>(entityName: "CDTransaction")
        request.predicate = NSPredicate(
            format: "(merchantName ==[c] %@ OR (merchantName == nil AND name ==[c] %@)) AND userCategory == nil",
            merchant, merchant
        )
        let matches = try context.fetch(request)
        let targets = includeReviewed ? matches : matches.filter { !$0.reviewed }
        for txn in targets {
            txn.userCategory = category
            txn.reviewed = true
        }
        try save()
        return targets.count
    }

    /// How many transactions still need a decision.
    static func unreviewedCount(in context: NSManagedObjectContext) -> Int {
        let request = NSFetchRequest<NSNumber>(entityName: "CDTransaction")
        request.resultType = .countResultType
        request.predicate = NSPredicate(format: "reviewed == NO")
        return (try? context.count(for: request)) ?? 0
    }

    private func save() throws {
        guard context.hasChanges else { return }
        try context.save()
    }
}
