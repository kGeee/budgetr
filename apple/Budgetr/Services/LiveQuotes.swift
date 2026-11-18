import Foundation
import SwiftUI

/// Live quotes for the positions the Mac last published, so the phone's
/// portfolio keeps moving with the market until the next sync.
///
/// It only ever asks for a price by ticker — the same thing the position chart
/// already does, and no more than the Mac itself sends to be priced. Nothing
/// about what you hold leaves the phone. Quotes live in memory and are thrown
/// away with the process; the synced summary on disk is never rewritten with
/// an estimate.
@MainActor
final class LiveQuotes: ObservableObject {
    @Published private(set) var quotes: [String: CompanionModel.LiveQuote] = [:]
    /// When the newest quote in `quotes` was fetched.
    @Published private(set) var fetchedAt: Date?
    @Published private(set) var refreshing = false

    /// Don't ask again sooner than this; MarketData caches for a minute anyway.
    private let minInterval: TimeInterval = 45
    private var lastAttempt: Date?

    /// The synced summary with whatever is quoted folded in.
    func book(for summary: Summary) -> CompanionModel.LiveBook {
        CompanionModel.reprice(summary, quotes: quotes)
    }

    /// Fetch a quote for every position the Mac sent a price for. Failures are
    /// silent per symbol: one unknown ticker shouldn't stop the rest, and with
    /// no quotes at all the screens simply show the synced figures.
    func refresh(for summary: Summary?, force: Bool = false) async {
        guard let summary, !refreshing else { return }
        let symbols = Array(Set((summary.positionPx ?? []).map(\.symbol)))
        guard !symbols.isEmpty else { return }
        if !force, let lastAttempt, Date().timeIntervalSince(lastAttempt) < minInterval { return }

        refreshing = true
        lastAttempt = Date()
        defer { refreshing = false }

        var fresh: [String: CompanionModel.LiveQuote] = [:]
        await withTaskGroup(of: (String, CompanionModel.LiveQuote?).self) { group in
            for symbol in symbols {
                group.addTask {
                    guard let s = try? await MarketData.shared.series(symbol, range: .day),
                          let price = s.price ?? s.points.last?.close, price > 0
                    else { return (symbol, nil) }
                    return (symbol, CompanionModel.LiveQuote(price: price, previousClose: s.previousClose))
                }
            }
            for await (symbol, quote) in group {
                if let quote { fresh[symbol] = quote }
            }
        }
        guard !fresh.isEmpty else { return }
        // Keep the last good quote for a symbol that failed this round.
        quotes.merge(fresh) { _, new in new }
        fetchedAt = Date()
    }

    /// Keep quotes fresh for as long as the calling view is on screen.
    func follow(_ summary: @escaping () -> Summary?) async {
        while !Task.isCancelled {
            await refresh(for: summary())
            try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
        }
    }
}
