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

    private var summaryURL: URL? {
        var base = material.relayUrl
        while base.hasSuffix("/") { base.removeLast() }
        guard let channel = material.channelId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return URL(string: "\(base)/v1/channels/\(channel)/summary")
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

    private var material: PairingMaterial?
    private var etag: String?

    private static let keychainAccount = "budgetr.companion.pairing"
    private static let lastSyncKey = "budgetr.companion.lastSync"

    init() {
        if let data = try? KeychainStore.get(Self.keychainAccount, synchronizable: false),
           let m = try? JSONDecoder().decode(PairingMaterial.self, from: data) {
            material = m
            phase = .paired
            summary = Self.loadCache()
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
        Self.clearCache()
        phase = .paired
        Haptics.success()
        await refresh()
        return nil
    }

    func unpair() {
        try? KeychainStore.delete(Self.keychainAccount, synchronizable: false)
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
        guard let material, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        if manual { Haptics.thud() }

        switch await RelayClient(material: material).fetchSummary(etag: summary == nil ? nil : etag) {
        case .fresh(let s, let tag):
            withAnimation(M.settle) { summary = s }
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
