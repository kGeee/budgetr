import Foundation

// The Summary the Mac publishes to the relay — `packages/core/src/contracts.ts`
// (SUMMARY_VERSION 2), as Codable. The phone is trusted glass, not a
// calculator: it renders what this carries and derives nothing financial from
// it beyond re-slicing (see CompanionModel). Optional fields are optional here
// for the same reason they are there — older writers simply omit them.

enum SummaryContract {
    static let version = 2

    enum Failure: Error, Equatable {
        /// Written by a newer budgetr than this build understands.
        case updateRequired
        /// Failed authentication: wrong key or tampered ciphertext.
        case tampered
        /// Decrypted, but not a summary this build can read.
        case invalid(String)
    }

    /// The relay's envelope (`envelope.ts`).
    struct Envelope: Codable {
        let v: Int
        let alg: String
        let nonce: String
        let ct: String
    }

    private struct VersionProbe: Decodable { let v: Int }

    /// Envelope JSON bytes → a validated summary. Every failure is one of three
    /// states the UI can say plainly; nothing partial is ever returned.
    static func open(_ envelopeJSON: Data, key: [UInt8]) throws -> Summary {
        guard let env = try? JSONDecoder().decode(Envelope.self, from: envelopeJSON) else {
            throw Failure.invalid("not an envelope")
        }
        guard env.v == 1, env.alg == "xsalsa20-poly1305" else { throw Failure.updateRequired }
        guard let nonce = Base64.decode(env.nonce), let boxed = Base64.decode(env.ct) else {
            throw Failure.tampered
        }
        let plaintext: [UInt8]
        do {
            plaintext = try SecretBox.open(boxed, nonce: nonce, key: key)
        } catch {
            throw Failure.tampered
        }
        return try decode(Data(plaintext))
    }

    /// Plain summary JSON → a summary, with the version gate first so a newer
    /// format reads as "update the app" rather than as corruption.
    static func decode(_ json: Data) throws -> Summary {
        guard let probe = try? JSONDecoder().decode(VersionProbe.self, from: json) else {
            throw Failure.invalid("no version")
        }
        if probe.v > version { throw Failure.updateRequired }
        guard probe.v == version else { throw Failure.invalid("unsupported version \(probe.v)") }
        do {
            return try JSONDecoder().decode(Summary.self, from: json)
        } catch {
            throw Failure.invalid(String(describing: error))
        }
    }
}

struct Summary: Codable, Equatable {
    let v: Int
    /// Unix seconds — when the Mac generated it.
    let asOf: Int
    let appliedOpIds: [String]
    let netWorth: NetWorth
    let accounts: [Account]
    let budgets: [Budget]
    /// Most recent first, capped (~40) — a tape, not the ledger.
    let recent: [Txn]
    /// Descending by value.
    let positions: [Position]
    let alerts: [Alert]
    let investments: Investments?
    let spendByDay: [SparkPoint]?
    let categories: [Category]?
    /// Budget month, budgeted categories only — what the desktop's Budgets
    /// pace line plots. Absent from older Macs.
    var budgetSpendByDay: [SparkPoint]? = nil
    // v2 — shared expenses. Absent on installs that have never split a bill.
    let people: [Person]?
    /// Most recent first.
    let shared: [SharedExpense]?
    /// Inflows the Mac thinks are paybacks, pending confirmation there.
    let settleSuggestions: [SettleSuggestion]?
    /// The newest outbox the Mac applies; nil from a Mac that predates the
    /// field, which reads v2 only. Gates what the phone sends (`OutboxContract.partition`).
    var outboxVersion: Int? = nil

    struct Person: Codable, Equatable, Identifiable {
        let id: String
        let name: String
        /// Hex, assigned on the Mac, so both apps colour a person alike.
        let color: String?
        /// Net, signed: positive = they owe you. Netted on the Mac.
        let cents: Int
        /// Unsettled bills they're on.
        let openCount: Int
        let lastSettledAt: Int?
        /// Venmo @handle, phone or email, as entered on the Mac.
        let handle: String?
    }

    struct SharedExpense: Codable, Equatable, Identifiable {
        let id: String
        let txnId: String
        let ts: Int
        let merchant: String
        /// The whole bill, positive.
        let cents: Int
        /// Your slice of it.
        let myCents: Int
        let shares: [Share]
        /// Built from a receipt, item by item.
        let itemized: Bool?
        let note: String?

        struct Share: Codable, Equatable {
            let personId: String
            let cents: Int
        }
    }

    struct SettleSuggestion: Codable, Equatable, Identifiable {
        var id: String { "\(txnId)|\(personId)" }
        let txnId: String
        let personId: String
        let ts: Int
        let cents: Int
        /// Pre-rendered on the Mac, e.g. "Venmo · matches their Ippudo share".
        let detail: String
    }

    struct SparkPoint: Codable, Equatable {
        /// Unix seconds at 00:00 UTC of the day.
        let d: Int
        let cents: Int
    }

    struct NetWorth: Codable, Equatable {
        let cents: Int
        let spark: [SparkPoint]
    }

    struct Account: Codable, Equatable, Identifiable {
        let id: String
        let name: String
        /// depository | credit | investment | loan | other
        let kind: String
        /// Signed; liabilities negative.
        let cents: Int
    }

    struct Budget: Codable, Equatable {
        /// Category key, matches `Txn.category`.
        let category: String
        let spentCents: Int
        let limitCents: Int
        /// ok | warn | over — the Mac decides; the phone never recomputes pace.
        let state: String
    }

    struct Txn: Codable, Equatable, Identifiable {
        let id: String
        /// Unix seconds.
        let ts: Int
        let merchant: String
        /// Signed; outflow negative.
        let cents: Int
        let category: String
        let pending: Bool
    }

    struct Position: Codable, Equatable {
        let symbol: String
        let cents: Int
        let name: String?
        /// Day move in basis points, signed (+82 = +0.82%).
        let dayBp: Int?
        let pnlCents: Int?
        let qtyLabel: String?
        let sector: String?
    }

    struct Alert: Codable, Equatable, Identifiable {
        let id: String
        let kind: String
        /// Pre-rendered, human-readable.
        let text: String
        let ts: Int
    }

    struct Investments: Codable, Equatable {
        let valueCents: Int
        let spark: [SparkPoint]
        let sectors: [Sector]
    }

    struct Sector: Codable, Equatable {
        let sector: String
        let cents: Int
    }

    struct Category: Codable, Equatable {
        let id: String
        let name: String
        let icon: String?
        /// income | spending | transfer
        let group: String
    }
}
