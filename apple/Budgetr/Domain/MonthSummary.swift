import Foundation

/// What one month of spending adds up to — the arithmetic behind the dashboard,
/// with no Core Data and no SwiftUI in it.
///
/// Kept pure for the same reason `BudgetPacing` is: this is the layer that has
/// to agree with the web app to the cent, and the only way to prove that is to
/// run it against fixtures rather than to look at a chart and nod.
///
/// Sign convention is the web app's, which is Plaid's: **positive is money
/// leaving the account**. Getting that backwards silently turns a paycheque into
/// the month's biggest expense, so every entry point here restates it.
struct MonthSummary {

    /// One transaction, reduced to what the dashboard needs.
    struct Entry {
        /// Positive = spent, negative = received.
        let amount: Double
        /// `YYYY-MM-DD`, as the web app stores it.
        let date: String
        /// Resolved category id — the user override if there is one.
        let categoryId: String?
        let pending: Bool
    }

    struct CategoryTotal: Identifiable {
        let id: String
        let name: String
        let spent: Double
    }

    struct DayTotal: Identifiable {
        let id: String
        let date: Date
        let spent: Double
    }

    // ── Windowing ────────────────────────────────────────────────────

    /// First day of `date`'s month, as `YYYY-MM-01`.
    static func monthKey(of date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }

    /// Entries falling inside `month` (a `YYYY-MM` key).
    ///
    /// Matches on the stored string rather than parsing to `Date`: the web app
    /// writes plain calendar dates with no timezone, and turning them into
    /// instants is how a transaction slides into the previous month for anyone
    /// west of UTC.
    static func inMonth(_ entries: [Entry], month: String) -> [Entry] {
        entries.filter { $0.date.hasPrefix(month) }
    }

    // ── Totals ───────────────────────────────────────────────────────

    /// Money spent — outflows only. Refunds and income don't reduce it, because
    /// "spent $1,200 this month" shouldn't move when payday lands.
    static func spent(_ entries: [Entry]) -> Double {
        entries.reduce(0) { $0 + max(0, $1.amount) }
    }

    /// Spend per day, ascending, with empty days omitted.
    static func byDay(_ entries: [Entry], calendar: Calendar = .current) -> [DayTotal] {
        var totals: [String: Double] = [:]
        for e in entries where e.amount > 0 {
            totals[e.date, default: 0] += e.amount
        }
        let fmt = DateFormatter()
        fmt.calendar = calendar
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = calendar.timeZone
        fmt.dateFormat = "yyyy-MM-dd"

        return totals.keys.sorted().compactMap { key in
            guard let d = fmt.date(from: key), let v = totals[key] else { return nil }
            return DayTotal(id: key, date: d, spent: v)
        }
    }

    /// Spend per category, descending, uncategorised folded into one bucket.
    static func byCategory(
        _ entries: [Entry],
        names: [String: String],
        limit: Int = 6
    ) -> [CategoryTotal] {
        var totals: [String: Double] = [:]
        for e in entries where e.amount > 0 {
            totals[e.categoryId ?? "", default: 0] += e.amount
        }
        let ranked = totals
            .map { CategoryTotal(id: $0.key, name: names[$0.key] ?? "Uncategorised", spent: $0.value) }
            .sorted { $0.spent > $1.spent }

        guard ranked.count > limit else { return ranked }
        // Everything past the cut becomes one honest row rather than vanishing.
        let head = Array(ranked.prefix(limit))
        let rest = ranked.dropFirst(limit).reduce(0) { $0 + $1.spent }
        return head + [CategoryTotal(id: "__other__", name: "Everything else", spent: rest)]
    }

    /// Spend on the same day-of-month last month, for a like-for-like delta.
    ///
    /// Comparing a half-finished month against a whole one is the mistake this
    /// exists to avoid — by the 8th you are always "down" on last month.
    static func priorMonthToDate(
        _ entries: [Entry],
        now: Date,
        calendar: Calendar = .current
    ) -> Double {
        guard let prior = calendar.date(byAdding: .month, value: -1, to: now) else { return 0 }
        let key = monthKey(of: prior, calendar: calendar)
        let dayOfMonth = calendar.component(.day, from: now)
        let cutoff = String(format: "%@-%02d", key, dayOfMonth)
        return spent(inMonth(entries, month: key).filter { $0.date <= cutoff })
    }

    /// Percent change against the same point last month, or nil when there is
    /// nothing to compare to.
    static func deltaPct(spent: Double, prior: Double) -> Double? {
        guard prior > 0.005 else { return nil }
        return ((spent - prior) / prior) * 100
    }
}
