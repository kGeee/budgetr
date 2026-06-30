import Foundation

/// Port of the auto-tagging engine in `web/lib/tag-rules.ts`.
///
/// A rule matches when a transaction's merchant name OR name *contains* the
/// rule's pattern, case-insensitively (the TS side stores patterns lowercased
/// and does a `LIKE %pattern%`). Matching is pure; applying the result to
/// Core Data (idempotent, INSERT-OR-IGNORE equivalent) happens in the sync engine.
struct AutoTagRule {
    let id: String
    let pattern: String   // assumed already lowercased, mirroring the TS store
    let tagId: String
}

enum AutoTagging {
    /// Returns the tag ids that should be applied to a transaction.
    static func matchingTagIds(
        merchantName: String?,
        name: String?,
        rules: [AutoTagRule]
    ) -> Set<String> {
        let haystack = [(merchantName ?? ""), (name ?? "")]
            .joined(separator: "\n")
            .lowercased()
        guard !haystack.isEmpty else { return [] }

        var result = Set<String>()
        for rule in rules where !rule.pattern.isEmpty {
            if haystack.contains(rule.pattern) {
                result.insert(rule.tagId)
            }
        }
        return result
    }
}
