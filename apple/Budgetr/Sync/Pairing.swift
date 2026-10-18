import Foundation

/// What the Mac's pairing QR carries, and what the phone keeps afterwards.
///
/// Port of `packages/sync-crypto/src/pairing.ts`. The code is
/// `budgetr1.` + base64url(JSON) — relay URL, channel id, bearer token and the
/// 32-byte sync key. The key therefore never crosses a network: the devices
/// exchange it on-screen, and the phone keeps it in its Keychain.
struct PairingMaterial: Codable, Equatable {
    let relayUrl: String
    let channelId: String
    let channelToken: String
    /// base64, 32 bytes. Decode at use; never log or display it.
    let syncKey: String

    var keyBytes: [UInt8] { Base64.decode(syncKey) ?? [] }
}

enum PairingCode {
    static let prefix = "budgetr1."
    static let version = 1

    enum Failure: Error, Equatable, LocalizedError {
        case notAPairingCode
        case malformed
        case unsupportedVersion(Int)
        case missing(String)
        case badRelayUrl
        case badKey

        var errorDescription: String? {
            switch self {
            case .notAPairingCode: return "That isn't a budgetr pairing code."
            case .malformed: return "That pairing code is damaged — scan it again."
            case .unsupportedVersion: return "This pairing code is from a newer budgetr. Update the app."
            case .missing, .badRelayUrl, .badKey: return "That pairing code is incomplete — generate a new one on your Mac."
            }
        }
    }

    private struct Payload: Decodable {
        let relayUrl: String?
        let channelId: String?
        let channelToken: String?
        let syncKey: String?
        let v: Int?
    }

    static func decode(_ raw: String) throws -> PairingMaterial {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.hasPrefix(prefix) else { throw Failure.notAPairingCode }
        guard let bytes = Base64.decodeURL(String(s.dropFirst(prefix.count))),
              let payload = try? JSONDecoder().decode(Payload.self, from: Data(bytes))
        else { throw Failure.malformed }

        guard payload.v == version else { throw Failure.unsupportedVersion(payload.v ?? 0) }
        func field(_ value: String?, _ name: String) throws -> String {
            guard let value, !value.isEmpty else { throw Failure.missing(name) }
            return value
        }
        let relay = try field(payload.relayUrl, "relayUrl")
        let channel = try field(payload.channelId, "channelId")
        let token = try field(payload.channelToken, "channelToken")
        let key = try field(payload.syncKey, "syncKey")

        guard relay.hasPrefix("https://") || relay.hasPrefix("http://") else { throw Failure.badRelayUrl }
        guard Base64.decode(key)?.count == SecretBox.keyBytes else { throw Failure.badKey }

        return PairingMaterial(relayUrl: relay, channelId: channel, channelToken: token, syncKey: key)
    }
}

/// Standard and URL-safe base64, strict about the alphabet the way the TS
/// side is, so a code that decodes here decodes there.
enum Base64 {
    static func decode(_ s: String) -> [UInt8]? {
        guard s.count % 4 == 0, let d = Data(base64Encoded: s) else { return nil }
        return [UInt8](d)
    }

    static func decodeURL(_ s: String) -> [UInt8]? {
        guard s.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
        var b64 = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        return decode(b64)
    }

    static func encode(_ bytes: [UInt8]) -> String { Data(bytes).base64EncodedString() }
}
