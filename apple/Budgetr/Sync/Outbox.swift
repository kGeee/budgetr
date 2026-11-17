import Foundation
import Security

// The phone's write path — `mobile/src/sync/client.ts`'s outbox, natively.
//
// An edit made here becomes an op: queued on disk, sealed into the same
// XSalsa20-Poly1305 envelope the summary arrives in, and POSTed to the relay,
// which only ever holds ciphertext. The Mac applies it through the same code
// its own UI uses, then lists the op's id in `Summary.appliedOpIds`; that is
// the only thing that removes it from the queue. Until then it is "pending" —
// resent on every sync, harmless to repeat because every op id is stable and
// the Mac applies each id once.
//
// The ops are the contract's (`packages/core/src/contracts.ts`, OUTBOX_VERSION 3).

enum OutboxContract {
    /// v3 added addPerson. A batch without it goes as v2, so a Mac that
    /// predates v3 still applies ordinary splits and paybacks.
    static let version = 3
    static let baseVersion = 2

    static func version(for ops: [CompanionOp]) -> Int {
        ops.contains { if case .addPerson = $0 { return true } else { return false } } ? version : baseVersion
    }

    /// What a Mac that reads outbox `peer` can take now, and what has to wait
    /// for it to update. A Mac that doesn't say (`Summary.outboxVersion` absent)
    /// predates the field and reads v2 only.
    ///
    /// Held: every addPerson, since a v2 Mac refuses the whole batch carrying
    /// one — and every edit naming a person added here, since that Mac would
    /// drop the share for someone it has never heard of and still confirm it.
    static func partition(_ ops: [CompanionOp], peer: Int?) -> (send: [CompanionOp], held: [CompanionOp]) {
        if (peer ?? baseVersion) >= version { return (ops, []) }
        var minted = Set<String>()
        for op in ops {
            if case .addPerson(let o) = op { minted.insert(o.personId) }
        }
        func waits(_ op: CompanionOp) -> Bool {
            switch op {
            case .addPerson: return true
            case .splitBill(let o): return o.shares.contains { minted.contains($0.personId) }
            case .recordSettlement(let o): return minted.contains(o.personId)
            }
        }
        return (ops.filter { !waits($0) }, ops.filter(waits))
    }
}

/// One edit, as it travels. Only the kinds this build can make.
enum CompanionOp: Codable, Equatable, Identifiable {
    case splitBill(SplitBill)
    case recordSettlement(RecordSettlement)
    case addPerson(AddPerson)

    struct AddPerson: Codable, Equatable {
        let id: String
        let ts: Int
        /// Minted here, so a split in the same batch can name them.
        let personId: String
        let name: String
        let handle: String?
        let color: String?
    }

    struct SplitBill: Codable, Equatable {
        let id: String
        let ts: Int
        let txnId: String
        /// Positive cents owed, per person — what they owe you, not your share.
        let shares: [Summary.SharedExpense.Share]
        let note: String?
        /// What the split was computed over when it isn't the charge — a
        /// receipt with a tip the bank hasn't settled yet.
        var basisCents: Int? = nil
        /// `{v:1, receipt, assignments}`, so the Mac can reopen it by item.
        var itemsJson: String? = nil
    }

    struct RecordSettlement: Codable, Equatable {
        let id: String
        let ts: Int
        let personId: String
        /// Positive.
        let cents: Int
        /// The inflow this settles, when confirming a spotted payback.
        let txnId: String?
    }

    var id: String {
        switch self {
        case .splitBill(let o): return o.id
        case .recordSettlement(let o): return o.id
        case .addPerson(let o): return o.id
        }
    }

    // The wire shape is flat with a `kind` discriminator, as in the contract.
    private enum CodingKeys: String, CodingKey {
        case kind, id, ts, txnId, shares, note, personId, cents, basisCents, itemsJson, name, handle, color
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .splitBill(let o):
            try c.encode("splitBill", forKey: .kind)
            try c.encode(o.id, forKey: .id)
            try c.encode(o.ts, forKey: .ts)
            try c.encode(o.txnId, forKey: .txnId)
            try c.encode(o.shares, forKey: .shares)
            try c.encodeIfPresent(o.note, forKey: .note)
            try c.encodeIfPresent(o.basisCents, forKey: .basisCents)
            try c.encodeIfPresent(o.itemsJson, forKey: .itemsJson)
        case .recordSettlement(let o):
            try c.encode("recordSettlement", forKey: .kind)
            try c.encode(o.id, forKey: .id)
            try c.encode(o.ts, forKey: .ts)
            try c.encode(o.personId, forKey: .personId)
            try c.encode(o.cents, forKey: .cents)
            try c.encodeIfPresent(o.txnId, forKey: .txnId)
        case .addPerson(let o):
            try c.encode("addPerson", forKey: .kind)
            try c.encode(o.id, forKey: .id)
            try c.encode(o.ts, forKey: .ts)
            try c.encode(o.personId, forKey: .personId)
            try c.encode(o.name, forKey: .name)
            try c.encodeIfPresent(o.handle, forKey: .handle)
            try c.encodeIfPresent(o.color, forKey: .color)
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "splitBill":
            self = .splitBill(SplitBill(
                id: try c.decode(String.self, forKey: .id),
                ts: try c.decode(Int.self, forKey: .ts),
                txnId: try c.decode(String.self, forKey: .txnId),
                shares: try c.decode([Summary.SharedExpense.Share].self, forKey: .shares),
                note: try c.decodeIfPresent(String.self, forKey: .note),
                basisCents: try c.decodeIfPresent(Int.self, forKey: .basisCents),
                itemsJson: try c.decodeIfPresent(String.self, forKey: .itemsJson)
            ))
        case "recordSettlement":
            self = .recordSettlement(RecordSettlement(
                id: try c.decode(String.self, forKey: .id),
                ts: try c.decode(Int.self, forKey: .ts),
                personId: try c.decode(String.self, forKey: .personId),
                cents: try c.decode(Int.self, forKey: .cents),
                txnId: try c.decodeIfPresent(String.self, forKey: .txnId)
            ))
        case "addPerson":
            self = .addPerson(AddPerson(
                id: try c.decode(String.self, forKey: .id),
                ts: try c.decode(Int.self, forKey: .ts),
                personId: try c.decode(String.self, forKey: .personId),
                name: try c.decode(String.self, forKey: .name),
                handle: try c.decodeIfPresent(String.self, forKey: .handle),
                color: try c.decodeIfPresent(String.self, forKey: .color)
            ))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown op kind \(other)")
        }
    }

    static func newId() -> String { UUID().uuidString.lowercased() }
    static func now() -> Int { Int(Date().timeIntervalSince1970) }
}

struct OutboxBatch: Encodable {
    let v: Int
    let deviceId: String
    let batchId: String
    let createdAt: Int
    let ops: [CompanionOp]
}

/// The relay envelope's sealing half (`envelope.ts` `seal`): a fresh random
/// nonce every time — reusing one breaks XSalsa20-Poly1305 outright.
enum Envelope {
    static func seal(_ plaintext: Data, key: [UInt8]) throws -> SummaryContract.Envelope {
        var nonce = [UInt8](repeating: 0, count: 24)
        guard SecRandomCopyBytes(kSecRandomDefault, nonce.count, &nonce) == errSecSuccess else {
            throw SummaryContract.Failure.invalid("no randomness")
        }
        let boxed = try SecretBox.seal([UInt8](plaintext), nonce: nonce, key: key)
        return SummaryContract.Envelope(v: 1, alg: "xsalsa20-poly1305", nonce: Base64.encode(nonce), ct: Base64.encode(boxed))
    }
}

/// The queue on disk — Application Support, excluded from backup, unreadable
/// while the phone is locked — so an edit made offline survives a relaunch.
enum OutboxStore {
    private static var url: URL? {
        guard let dir = try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ) else { return nil }
        return dir.appendingPathComponent("companion-outbox.json")
    }

    static func load() -> [CompanionOp] {
        guard let url, let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([CompanionOp].self, from: data)) ?? []
    }

    static func save(_ ops: [CompanionOp]) {
        guard var url else { return }
        if ops.isEmpty {
            try? FileManager.default.removeItem(at: url)
            return
        }
        guard let data = try? JSONEncoder().encode(ops) else { return }
        #if os(iOS)
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try? data.write(to: url, options: .atomic)
        #endif
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    /// Stable per install, as the contract asks.
    static var deviceId: String {
        let key = "budgetr.companion.deviceId"
        if let id = UserDefaults.standard.string(forKey: key) { return id }
        let id = "dev_\(CompanionOp.newId())"
        UserDefaults.standard.set(id, forKey: key)
        return id
    }
}
