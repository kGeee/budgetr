import Foundation

/// Talks to the thin backend proxy (the existing Next.js app under `/web`),
/// which holds the Plaid / Finnhub secrets that must never ship inside the app
/// binary. The app sends only non-secret requests; the proxy adds credentials
/// server-side and forwards to Plaid / Finnhub / Yahoo.
///
/// Endpoints mirror the current routes:
///   POST /api/plaid/create-link-token
///   POST /api/plaid/exchange-public-token   { public_token } -> { item_id, ... }
///   POST /api/plaid/sync                     { item_id, cursor? } -> sync delta
///   GET  /api/prices?symbols=...             -> quotes + ws token
actor ProxyClient {
    struct Config {
        /// e.g. https://budgetr.vercel.app  (set per build configuration)
        var baseURL: URL
        /// Optional shared bearer so only your app can call the proxy.
        var appToken: String?
    }

    enum ProxyError: Error { case badStatus(Int), invalidResponse }

    private let config: Config
    private let session: URLSession

    init(config: Config, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    func createLinkToken() async throws -> String {
        struct Response: Decodable { let link_token: String }
        let res: Response = try await post("/api/plaid/create-link-token", body: EmptyBody())
        return res.link_token
    }

    func exchangePublicToken(_ publicToken: String) async throws -> String {
        struct Body: Encodable { let public_token: String }
        struct Response: Decodable { let item_id: String }
        let res: Response = try await post("/api/plaid/exchange-public-token",
                                           body: Body(public_token: publicToken))
        return res.item_id
    }

    // MARK: - Plumbing

    private struct EmptyBody: Encodable {}

    private func post<B: Encodable, R: Decodable>(_ path: String, body: B) async throws -> R {
        var request = URLRequest(url: config.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let appToken = config.appToken {
            request.setValue("Bearer \(appToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ProxyError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw ProxyError.badStatus(http.statusCode) }
        return try JSONDecoder().decode(R.self, from: data)
    }
}
