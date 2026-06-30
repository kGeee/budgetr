import Foundation

/// Port of the vendor-grouping logic (`web/lib/actions.ts` vendor merge +
/// `vendor_groups` / `vendor_group_members`).
///
/// A raw vendor key is `COALESCE(merchant_name, name)`. Each raw key belongs to
/// at most one group; categorizing one member's transaction can be fanned out to
/// every transaction whose raw key maps to the same group.
enum VendorGrouping {
    /// The canonical raw vendor key for a transaction.
    static func vendorKey(merchantName: String?, name: String?) -> String {
        let merchant = merchantName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let merchant, !merchant.isEmpty { return merchant }
        return (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Given a member→group map, returns the group id for a transaction's vendor key.
    static func groupId(forMerchant merchantName: String?,
                        name: String?,
                        memberToGroup: [String: String]) -> String? {
        memberToGroup[vendorKey(merchantName: merchantName, name: name)]
    }
}
