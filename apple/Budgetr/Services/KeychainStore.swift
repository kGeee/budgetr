import Foundation
import Security

/// Minimal Keychain wrapper for the AES key that encrypts Plaid access tokens at
/// rest (replaces the `APP_ENCRYPTION_KEY` env var in `web/lib/crypto.ts`).
///
/// `kSecAttrSynchronizable = true` lets the key ride iCloud Keychain to the user's
/// other devices, so an item encrypted on the Mac decrypts on iPhone.
enum KeychainStore {
    enum KeychainError: Error { case unexpectedStatus(OSStatus) }

    static func set(_ data: Data, for account: String, synchronizable: Bool = true) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: synchronizable,
        ]
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }

    static func get(_ account: String, synchronizable: Bool = true) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: synchronizable,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        return item as? Data
    }
}
