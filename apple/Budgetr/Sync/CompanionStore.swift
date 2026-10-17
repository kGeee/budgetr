import Foundation
import SwiftUI

/// The phone's half of companion sync, read-only.
///
/// Port of the read path in `mobile/src/sync/client.ts`: GET the summary with
/// `If-None-Match`, open the envelope, gate on version, keep it. No outbox —
/// this build shows what the Mac publishes and sends nothing back.
struct RelayClient {
    let material: PairingMaterial

    enum Outcome {
        case fresh(Summary, etag: String?)
        case notModified
        /// The Mac is paired but hasn't published yet.
        case nothingYet
        case updateRequired
        case tampered
        case offline(String)
        case failed(String)
    }

    func fetchSummary(etag: String?) async -> Outcome {
        guard let url = summaryURL else { return .failed("the pairing has a bad relay address") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("Bearer \(material.channelToken)", forHTTPHeaderField: "Authorization")
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            return .offline(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { return .failed("no response from the relay") }

        switch http.statusCode {
        case 304: return .notModified
        case 404: return .nothingYet
        case 401, 403: return .failed("the relay no longer recognises this pairing — pair again")
        case 200: break
        default: return .failed("relay error (\(http.statusCode))")
        }

        do {
            let summary = try SummaryContract.open(data, key: material.keyBytes)
            return .fresh(summary, etag: http.value(forHTTPHeaderField: "ETag"))
        } catch SummaryContract.Failure.updateRequired {
            return .updateRequired
        } catch SummaryContract.Failure.tampered {
            return .tampered
        } catch {
            return .failed("the Mac sent something this version can't read")
        }
    }

    private var summaryURL: URL? { channelURL("/summary") }

    func channelURL(_ path: String) -> URL? {
        var base = material.relayUrl
        while base.hasSuffix("/") { base.removeLast() }
        guard let channel = material.channelId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return URL(string: "\(base)/v1/channels/\(channel)\(path)")
    }
}

/// Pairing, the cached summary, and sync status — one instance, owned by the
/// shell. Render-from-cache first, refresh on foreground and on pull.
///
/// Failure modes are states, not crashes: offline or a failed check keeps the
/// last good summary on screen with a banner saying so; a newer format says
/// "update the app".
@MainActor
final class CompanionStore: ObservableObject {
    enum Phase: Equatable { case unpaired, paired, updateRequired }

    @Published private(set) var phase: Phase = .unpaired
    @Published private(set) var summary: Summary?
    @Published private(set) var lastSyncAt: Date?
    /// Human sentence when the last refresh didn't land; nil when healthy.
    @Published private(set) var syncError: String?
    @Published private(set) var refreshing = false
    /// Edits made here that the Mac hasn't confirmed applying yet.
    @Published private(set) var pending: [CompanionOp] = []

    private var material: PairingMaterial?
    private var etag: String?

    private static let keychainAccount = "budgetr.companion.pairing"
    private static let lastSyncKey = "budgetr.companion.lastSync"

    init() {
        #if DEBUG
        if CompanionDemo.isActive {
            phase = .paired
            summary = CompanionDemo.make()
            lastSyncAt = Date().addingTimeInterval(-180)
            return
        }
        #endif
        if let data = try? KeychainStore.get(Self.keychainAccount, synchronizable: false),
           let m = try? JSONDecoder().decode(PairingMaterial.self, from: data) {
            material = m
            phase = .paired
            summary = Self.loadCache()
            pending = OutboxStore.load()
            let t = UserDefaults.standard.double(forKey: Self.lastSyncKey)
            lastSyncAt = t > 0 ? Date(timeIntervalSince1970: t) : nil
        }
    }

    var isPaired: Bool { phase != .unpaired }

    /// Over a day old: say so, so stale numbers never pass as today's.
    var isStale: Bool {
        guard let lastSyncAt else { return summary != nil }
        return Date().timeIntervalSince(lastSyncAt) > 24 * 3600
    }

    /// Decodes and keeps a scanned or pasted code. Returns a sentence for the
    /// user on failure, nil on success.
    func pair(_ code: String) async -> String? {
        let m: PairingMaterial
        do {
            m = try PairingCode.decode(code)
        } catch {
            Haptics.error()
            return (error as? LocalizedError)?.errorDescription ?? "That isn't a budgetr pairing code."
        }
        do {
            // This device only: the key arrived by camera and leaves with the
            // phone, never through iCloud Keychain.
            try KeychainStore.set(try JSONEncoder().encode(m), for: Self.keychainAccount, synchronizable: false)
        } catch {
            Haptics.error()
            return "Couldn't save the pairing to the Keychain."
        }
        material = m
        etag = nil
        summary = nil
        // Edits queued for a previous pairing belong to that Mac.
        pending = []
        OutboxStore.save([])
        Self.clearCache()
        phase = .paired
        Haptics.success()
        await refresh()
        return nil
    }

    /// Queues an edit for the Mac and sends it straight away if it can.
    /// It shows as pending until the Mac confirms it in a summary.
    func submit(_ op: CompanionOp) async {
        pending.append(op)
        persistPending()
        Haptics.success()
        await refresh()
    }

    /// Everyone you can split with: the Mac's people, plus anyone added here
    /// that the Mac hasn't confirmed yet — so a new friend is usable at once.
    var knownPeople: [Summary.Person] {
        var people = summary?.people ?? []
        let ids = Set(people.map(\.id))
        for op in pending {
            if case .addPerson(let o) = op, !ids.contains(o.personId) {
                people.append(.init(id: o.personId, name: o.name, color: o.color, cents: 0, openCount: 0, lastSettledAt: nil, handle: o.handle))
            }
        }
        return people
    }

    /// Queues someone new and returns their (phone-minted) id. A name the Mac
    /// already has resolves to that person on the Mac's side.
    @discardableResult
    func addPerson(name: String, handle: String?) async -> String {
        let palette = ["#6FE3A6", "#7FB2E0", "#E0C36F", "#B59CE0", "#5FC9C0", "#E08FB8", "#9AD17F", "#F0897B"]
        let taken = Set(knownPeople.compactMap { $0.color?.uppercased() })
        let color = palette.first { !taken.contains($0) } ?? palette[knownPeople.count % palette.count]
        let personId = "person_\(CompanionOp.newId().prefix(12))"
        let h = handle?.trimmingCharacters(in: .whitespacesAndNewlines)
        await submit(.addPerson(.init(
            id: CompanionOp.newId(), ts: CompanionOp.now(), personId: personId,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            handle: (h?.isEmpty ?? true) ? nil : h, color: color
        )))
        return personId
    }

    /// Drops an edit that hasn't reached the Mac yet — or has, but not been
    /// applied; the Mac ignores ids it never receives.
    func discard(_ op: CompanionOp) {
        pending.removeAll { $0.id == op.id }
        persistPending()
    }

    /// Demo edits live in memory only: written to the real queue, they'd be
    /// sent to a real Mac the moment this phone paired with one.
    private func persistPending() {
        #if DEBUG
        if CompanionDemo.isActive { return }
        #endif
        OutboxStore.save(pending)
    }

    func unpair() {
        try? KeychainStore.delete(Self.keychainAccount, synchronizable: false)
        pending = []
        OutboxStore.save([])
        Self.clearCache()
        UserDefaults.standard.removeObject(forKey: Self.lastSyncKey)
        material = nil
        etag = nil
        summary = nil
        lastSyncAt = nil
        syncError = nil
        phase = .unpaired
    }

    func refresh(manual: Bool = false) async {
        #if DEBUG
        if CompanionDemo.isActive {
            refreshing = true
            try? await Task.sleep(for: .milliseconds(700))
            lastSyncAt = Date()
            refreshing = false
            if manual { Haptics.success() }
            return
        }
        #endif
        guard let material, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        if manual { Haptics.thud() }

        let client = RelayClient(material: material)
        // Edits first, so the summary fetched next has the best chance of
        // already reflecting them.
        var pushProblem: String?
        switch await client.push(pending, deviceId: OutboxStore.deviceId) {
        case .sent: break
        case .offline: pushProblem = "Offline — your edits will send when you're back."
        case .failed(let why): pushProblem = why.prefix(1).uppercased() + why.dropFirst()
        }

        // A fresh summary is needed to see confirmations, so skip the ETag
        // while anything is waiting.
        switch await client.fetchSummary(etag: summary == nil || !pending.isEmpty ? nil : etag) {
        case .fresh(let s, let tag):
            let applied = Set(s.appliedOpIds)
            withAnimation(M.settle) {
                summary = s
                pending.removeAll { applied.contains($0.id) }
            }
            OutboxStore.save(pending)
            etag = tag
            Self.saveCache(s)
            markSynced()
        case .notModified:
            markSynced()
        case .nothingYet:
            syncError = "Your Mac hasn't published a summary yet — open budgetr there."
        case .updateRequired:
            phase = .updateRequired
        case .tampered:
            syncError = "Sync data failed verification — showing saved data."
        case .offline:
            syncError = "Offline — showing saved data."
        case .failed(let why):
            syncError = why.prefix(1).uppercased() + why.dropFirst()
        }
        if syncError == nil, let pushProblem { syncError = pushProblem }
        if manual && syncError == nil { Haptics.success() }
    }

    private func markSynced() {
        syncError = nil
        let now = Date()
        lastSyncAt = now
        UserDefaults.standard.set(now.timeIntervalSince1970, forKey: Self.lastSyncKey)
    }

    // ── Cache ────────────────────────────────────────────────────────
    // The decrypted summary, so the app opens on numbers rather than a spinner.
    // Application Support, excluded from backup, and file-protected on iOS so
    // it's unreadable while the phone is locked.

    private static var cacheURL: URL? {
        guard let dir = try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ) else { return nil }
        return dir.appendingPathComponent("companion-summary.json")
    }

    private static func loadCache() -> Summary? {
        guard let url = cacheURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? SummaryContract.decode(data)
    }

    private static func saveCache(_ s: Summary) {
        guard var url = cacheURL, let data = try? JSONEncoder().encode(s) else { return }
        #if os(iOS)
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try? data.write(to: url, options: .atomic)
        #endif
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    private static func clearCache() {
        guard let url = cacheURL else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

// ── Outbox transport ─────────────────────────────────────────────────

extension RelayClient {
    enum PushOutcome: Equatable { case sent, offline, failed(String) }

    /// POSTs the whole queue as one sealed batch. Safe to repeat.
    func push(_ ops: [CompanionOp], deviceId: String) async -> PushOutcome {
        guard !ops.isEmpty else { return .sent }
        guard let url = channelURL("/outbox") else { return .failed("the pairing has a bad relay address") }

        let batch = OutboxBatch(
            v: OutboxContract.version(for: ops),
            deviceId: deviceId,
            batchId: CompanionOp.newId(),
            createdAt: CompanionOp.now(),
            ops: ops
        )
        let body: Data
        do {
            body = try JSONEncoder().encode(Envelope.seal(try JSONEncoder().encode(batch), key: material.keyBytes))
        } catch {
            return .failed("couldn't seal the edit")
        }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("Bearer \(material.channelToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(batch.batchId, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = body

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .failed("no response from the relay") }
            if (200..<300).contains(http.statusCode) { return .sent }
            if http.statusCode == 401 || http.statusCode == 403 { return .failed("the relay no longer recognises this pairing — pair again") }
            return .failed("relay refused the edit (\(http.statusCode))")
        } catch {
            return .offline
        }
    }
}
