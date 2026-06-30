import Foundation
import CryptoKit

/// AES-256-GCM encryption for Plaid access tokens at rest — the native
/// equivalent of `web/lib/crypto.ts`. The symmetric key lives in the Keychain
/// (see `KeychainStore`) and syncs via iCloud Keychain.
enum AppCrypto {
    private static let keyAccount = "budgetr.aes.tokenKey"

    /// Loads the token-encryption key, generating + persisting one on first use.
    static func tokenKey() throws -> SymmetricKey {
        if let existing = try KeychainStore.get(keyAccount) {
            return SymmetricKey(data: existing)
        }
        let key = SymmetricKey(size: .bits256)
        let raw = key.withUnsafeBytes { Data($0) }
        try KeychainStore.set(raw, for: keyAccount)
        return key
    }

    /// Encrypts plaintext, returning the combined GCM box (nonce + ciphertext + tag).
    static func encrypt(_ plaintext: Data, key: SymmetricKey) throws -> Data {
        let sealed = try AES.GCM.seal(plaintext, using: key)
        guard let combined = sealed.combined else {
            throw CocoaError(.coderInvalidValue)
        }
        return combined
    }

    static func decrypt(_ combined: Data, key: SymmetricKey) throws -> Data {
        let box = try AES.GCM.SealedBox(combined: combined)
        return try AES.GCM.open(box, using: key)
    }
}
