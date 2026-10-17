import Foundation

/// Price history for one symbol, read from Yahoo Finance's public chart
/// endpoint — the same source the desktop app prices from.
///
/// The Summary carries what the Mac knows about a holding (value, quantity,
/// P&L, today's move) but no history, and a chart needs one. Only the ticker
/// leaves the phone, which is no more than the Mac already sends to price it;
/// nothing about the holding itself does. Fetched on demand when a position is
/// opened, cached briefly in memory, never written to disk.
actor MarketData {
    static let shared = MarketData()

    enum Range: String, CaseIterable, Identifiable {
        case day = "1D", week = "1W", month = "1M", quarter = "3M", year = "1Y", fiveYears = "5Y"

        var id: String { rawValue }

        fileprivate var query: (range: String, interval: String) {
            switch self {
            case .day: return ("1d", "5m")
            case .week: return ("5d", "30m")
            case .month: return ("1mo", "1d")
            case .quarter: return ("3mo", "1d")
            case .year: return ("1y", "1d")
            case .fiveYears: return ("5y", "1wk")
            }
        }

        /// Intraday ranges label points with a time, the rest with a date.
        var intraday: Bool { self == .day || self == .week }
    }

    struct Point: Identifiable, Equatable {
        var id: Date { date }
        let date: Date
        let close: Double
    }

    struct Series: Equatable {
        let symbol: String
        let points: [Point]
        let price: Double?
        /// The close before the range began — the baseline a 1D chart is read against.
        let previousClose: Double?
        let dayHigh: Double?
        let dayLow: Double?
        let yearHigh: Double?
        let yearLow: Double?
        let volume: Double?
        let currency: String?
        let exchange: String?
        let name: String?
        let kind: String?
        let fetchedAt: Date

        /// First point to last, as a fraction; for 1D, against yesterday's close.
        var change: Double? {
            let base = previousClose ?? points.first?.close
            guard let base, base > 0, let last = price ?? points.last?.close else { return nil }
            return (last - base) / base
        }
    }

    enum Failure: Error, Equatable {
        case offline
        case notFound
        case unreadable
    }

    private var cache: [String: Series] = [:]
    private let ttl: TimeInterval = 60

    func series(_ symbol: String, range: Range) async throws -> Series {
        let key = "\(symbol)|\(range.rawValue)"
        if let hit = cache[key], Date().timeIntervalSince(hit.fetchedAt) < ttl { return hit }

        let q = range.query
        guard let encoded = symbol.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "https://query2.finance.yahoo.com/v8/finance/chart/\(encoded)?range=\(q.range)&interval=\(q.interval)&includePrePost=false")
        else { throw Failure.notFound }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        // Yahoo turns away requests with no browser-like agent.
        request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", forHTTPHeaderField: "User-Agent")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw Failure.offline
        }
        if let http = response as? HTTPURLResponse, http.statusCode == 404 { throw Failure.notFound }

        guard let decoded = try? JSONDecoder().decode(Envelope.self, from: data),
              let result = decoded.chart.result?.first
        else { throw Failure.unreadable }

        let closes = result.indicators.quote.first?.close ?? []
        let stamps = result.timestamp ?? []
        let points = zip(stamps, closes).compactMap { ts, close -> Point? in
            guard let close else { return nil }
            return Point(date: Date(timeIntervalSince1970: TimeInterval(ts)), close: close)
        }
        guard !points.isEmpty else { throw Failure.notFound }

        let m = result.meta
        let series = Series(
            symbol: symbol,
            points: points,
            price: m.regularMarketPrice,
            previousClose: range == .day ? (m.previousClose ?? m.chartPreviousClose) : nil,
            dayHigh: m.regularMarketDayHigh,
            dayLow: m.regularMarketDayLow,
            yearHigh: m.fiftyTwoWeekHigh,
            yearLow: m.fiftyTwoWeekLow,
            volume: m.regularMarketVolume,
            currency: m.currency,
            // "CCC" is Yahoo's placeholder for crypto — not an exchange anyone knows.
            exchange: (m.fullExchangeName ?? m.exchangeName).flatMap { $0 == "CCC" ? nil : $0 },
            name: m.longName ?? m.shortName,
            kind: m.instrumentType,
            fetchedAt: Date()
        )
        cache[key] = series
        return series
    }

    // ── Wire format ──────────────────────────────────────────────────

    private struct Envelope: Decodable {
        let chart: Chart
        struct Chart: Decodable { let result: [Result]? }
        struct Result: Decodable {
            let meta: Meta
            let timestamp: [Int]?
            let indicators: Indicators
        }
        struct Indicators: Decodable { let quote: [Quote] }
        struct Quote: Decodable { let close: [Double?]? }
    }

    private struct Meta: Decodable {
        let currency: String?
        let exchangeName: String?
        let fullExchangeName: String?
        let instrumentType: String?
        let regularMarketPrice: Double?
        let chartPreviousClose: Double?
        let previousClose: Double?
        let regularMarketDayHigh: Double?
        let regularMarketDayLow: Double?
        let fiftyTwoWeekHigh: Double?
        let fiftyTwoWeekLow: Double?
        let regularMarketVolume: Double?
        let longName: String?
        let shortName: String?
    }
}
