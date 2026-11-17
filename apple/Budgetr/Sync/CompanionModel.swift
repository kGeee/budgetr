import Foundation

/// Month-to-date derivations for the paired screens — `mobile/src/spending.ts`.
///
/// The phone is not a calculator, but the Summary carries no per-category month
/// total, so these are the minimum re-slicings needed to draw one. Nothing here
/// invents a financial value:
///  · the month total comes from `spendByDay`, which the Mac derived
///  · a budgeted category's total is `Budget.spentCents`, verbatim
///  · only unbudgeted categories are summed from `recent`, and that tape is
///    capped — so those are a floor, flagged `partial`, and the UI says so.
///
/// Day math is UTC throughout, matching how the Mac stamps `SparkPoint.d`.
enum CompanionModel {
    static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    struct Month {
        let startSec: Int
        let prevStartSec: Int
        let dayOfMonth: Int
        let daysInMonth: Int
        let label: String

        init(now: Date = Date()) {
            let cal = CompanionModel.utc
            let parts = cal.dateComponents([.year, .month, .day], from: now)
            let start = cal.date(from: DateComponents(year: parts.year, month: parts.month, day: 1)) ?? now
            let prev = cal.date(byAdding: .month, value: -1, to: start) ?? start
            let days = cal.range(of: .day, in: .month, for: start)?.count ?? 30
            startSec = Int(start.timeIntervalSince1970)
            prevStartSec = Int(prev.timeIntervalSince1970)
            daysInMonth = days
            dayOfMonth = min(parts.day ?? 1, days)
            let f = DateFormatter()
            f.timeZone = cal.timeZone
            f.dateFormat = "LLLL"
            label = f.string(from: start)
        }
    }

    struct Totals {
        let spentCents: Int
        let priorCents: Int
        /// nil when there is no prior month to compare against.
        let deltaPct: Double?
        /// Spend per elapsed day, day 1 first, zeros kept.
        let perDay: [Int]
        /// Running total per elapsed day.
        let cumulative: [Int]
    }

    static func dayOfMonth(_ sec: Int) -> Int {
        utc.component(.day, from: Date(timeIntervalSince1970: TimeInterval(sec)))
    }

    static func totals(_ spendByDay: [Summary.SparkPoint], month: Month) -> Totals {
        var perDay = [Int](repeating: 0, count: month.dayOfMonth)
        for p in spendByDay where p.d >= month.startSec {
            let d = dayOfMonth(p.d)
            if d >= 1 && d <= month.dayOfMonth { perDay[d - 1] += p.cents }
        }
        var run = 0
        let cumulative = perDay.map { run += $0; return run }

        // The same slice of last month, not its whole — on the 3rd, a whole
        // month would always read as a collapse.
        let prior = spendByDay
            .filter { $0.d >= month.prevStartSec && $0.d < month.startSec && dayOfMonth($0.d) <= month.dayOfMonth }
            .reduce(0) { $0 + $1.cents }

        return Totals(
            spentCents: run,
            priorCents: prior,
            deltaPct: prior > 0 ? Double(run - prior) / Double(prior) * 100 : nil,
            perDay: perDay,
            cumulative: cumulative
        )
    }

    struct CategorySpend: Identifiable {
        let id: String
        let name: String
        let icon: String?
        let cents: Int
        let budget: Summary.Budget?
        /// Summed from the capped recent tape — a floor, not the truth.
        let partial: Bool
    }

    static func categoryIndex(_ s: Summary) -> [String: Summary.Category] {
        Dictionary((s.categories ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// "cat_dining_out" → "Dining Out", for keys the vocabulary doesn't name.
    static func label(_ key: String) -> String {
        var k = key
        if k.hasPrefix("cat_") || k.hasPrefix("cat-") { k.removeFirst(4) }
        return k.split(whereSeparator: { $0 == "_" || $0 == "-" })
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    static func name(_ key: String, _ index: [String: Summary.Category]) -> String {
        index[key]?.name ?? label(key)
    }

    // ── Budget figures ───────────────────────────────────────────────
    // Measured the desktop's way: only categories that HAVE a budget count
    // against the budget. Rent with no envelope is spending, but it isn't
    // budget spending — comparing all spend to the budget total overstated
    // every reading on the phone.

    /// What's been spent against the budget this month — the Mac's own sum.
    static func budgetedSpent(_ s: Summary) -> Int { s.budgets.reduce(0) { $0 + $1.spentCents } }

    static func budgetLimit(_ s: Summary) -> Int { s.budgets.reduce(0) { $0 + $1.limitCents } }

    /// The budgeted-only daily series for the pace line; nil from a Mac that
    /// doesn't send it (drawing all spend instead would be the old bug).
    static func budgetTotals(_ s: Summary, month: Month) -> Totals? {
        guard let series = s.budgetSpendByDay else { return nil }
        return totals(series, month: month)
    }

    // ── Fixed and flexible ───────────────────────────────────────────
    // A fixed cost (rent) lands in one charge on the 1st, so holding it to an
    // even daily burn reads as "ahead of pace" all month. Once the Mac marks
    // any budget fixed, pace is judged on the rest — the same split, and the
    // same sentence, as the desktop's Budgets page (web/lib/budget-verdict.ts).

    struct BudgetPosition: Equatable {
        let fixedSpent: Int
        let fixedLimit: Int
        let flexibleSpent: Int
        let flexibleLimit: Int

        var totalSpent: Int { fixedSpent + flexibleSpent }
        var totalLimit: Int { fixedLimit + flexibleLimit }
        /// Left across every budget — the hero figure.
        var left: Int { totalLimit - totalSpent }
        /// Only narrow to flexible when something flexible is left to judge; a
        /// month of nothing but fixed budgets reads as the whole month.
        var judgesFlexible: Bool { fixedLimit > 0 && flexibleLimit > 0 }
        var paceSpent: Int { judgesFlexible ? flexibleSpent : totalSpent }
        var paceLimit: Int { judgesFlexible ? flexibleLimit : totalLimit }
    }

    static func budgetPosition(_ s: Summary) -> BudgetPosition {
        var fs = 0, fl = 0, xs = 0, xl = 0
        for b in s.budgets {
            if b.isFixed { fs += b.spentCents; fl += b.limitCents } else { xs += b.spentCents; xl += b.limitCents }
        }
        return BudgetPosition(fixedSpent: fs, fixedLimit: fl, flexibleSpent: xs, flexibleLimit: xl)
    }

    /// The daily series the pace line should plot: flexible budgets only when
    /// the Mac sends that split, otherwise every budgeted category as before.
    static func paceTotals(_ s: Summary, month: Month) -> Totals? {
        if budgetPosition(s).judgesFlexible, let flexible = s.flexibleSpendByDay {
            return totals(flexible, month: month)
        }
        return budgetTotals(s, month: month)
    }

    struct PaceVerdict: Equatable {
        enum Tone { case ok, warn, over }
        let tone: Tone
        /// Words before the figure.
        let lead: String
        /// The amount the sentence turns on, in cents.
        let cents: Int
        /// Words after the figure, including the full stop.
        let tail: String
    }

    /// The sentence under "Left to spend". Mirrors `budgetVerdict` on the web,
    /// in cents, so the phone and the Mac never give different readings.
    static func paceVerdict(_ p: BudgetPosition, dayOfMonth: Int, daysInMonth: Int) -> PaceVerdict? {
        guard p.totalLimit > 0 else { return nil }
        let subject = p.judgesFlexible ? "Flexible spending" : "Spending"
        let total = max(1, daysInMonth)
        let day = min(total, max(1, dayOfMonth))
        let left = total - day
        let days = "\(left) day\(left == 1 ? "" : "s")"
        let over = p.paceSpent - p.paceLimit

        if over > 0 {
            return PaceVerdict(
                tone: .over,
                lead: p.judgesFlexible ? "Flexible spending is" : "You are",
                cents: over,
                tail: left > 0 ? "over budget with \(days) left." : "over budget."
            )
        }
        if left == 0 {
            return PaceVerdict(
                tone: .ok,
                lead: p.judgesFlexible ? "Flexible spending closed" : "The month closed",
                cents: -over,
                tail: "under budget."
            )
        }
        // Integer cents: expected = limit × day / total, rounded to the cent.
        let expected = Int((Double(p.paceLimit) * Double(day) / Double(total)).rounded())
        let gap = expected - p.paceSpent
        return gap >= 0
            ? PaceVerdict(tone: .ok, lead: "\(subject) is", cents: gap, tail: "under an even pace, with \(days) left.")
            : PaceVerdict(tone: .warn, lead: "\(subject) is", cents: -gap, tail: "ahead of an even pace, with \(days) left.")
    }

    // ── What counts as spend ─────────────────────────────────────────
    // The Mac's rule, applied to the tape: a transaction is spend when its
    // (effective) category is in the spending group. Card payments ("AMERICAN
    // EXPRESS ACH PMT", the card-side "AUTOPAY PAYMENT"), transfers between
    // your own accounts and fronted shares of a split bill all sit in the
    // transfer group, so they are never spend and never income — exactly as
    // the Mac's spendByDay and budgets treat them.

    enum Flow { case spend, income, transfer }

    /// A category key's group. The vocabulary decides when it names the key;
    /// otherwise the key itself is read — a transfer or card-payment key is
    /// never spend — and anything else counts as spending, so a budgeted or
    /// newly created category the vocabulary hasn't caught up with still shows.
    static func group(_ key: String, _ index: [String: Summary.Category]) -> String? {
        if let g = index[key]?.group { return g }
        let k = key.lowercased()
        if k.contains("transfer") || k.contains("loan_payment") || k.contains("reimburs") { return "transfer" }
        if k.contains("income") { return "income" }
        return "spending"
    }

    static func flow(_ t: Summary.Txn, _ index: [String: Summary.Category]) -> Flow {
        switch group(t.category, index) {
        case "spending": return t.cents < 0 ? .spend : .income // a refund on a purchase
        case "income": return t.cents > 0 ? .income : .transfer
        default: return .transfer
        }
    }

    static func isSpend(_ t: Summary.Txn, _ index: [String: Summary.Category]) -> Bool {
        t.cents < 0 && flow(t, index) == .spend
    }

    static func isIncome(_ t: Summary.Txn, _ index: [String: Summary.Category]) -> Bool {
        t.cents > 0 && group(t.category, index) == "income"
    }

    /// Month to date by category, descending. Income and transfers never count.
    static func categorySpend(_ s: Summary, month: Month) -> [CategorySpend] {
        let index = categoryIndex(s)
        func isSpend(_ id: String) -> Bool { group(id, index) == "spending" }

        let budgets = Dictionary(s.budgets.map { ($0.category, $0) }, uniquingKeysWith: { a, _ in a })
        var fromTape: [String: Int] = [:]
        for t in s.recent where t.ts >= month.startSec && t.cents < 0 {
            if budgets[t.category] != nil || !isSpend(t.category) { continue }
            fromTape[t.category, default: 0] += abs(t.cents)
        }

        var rows: [CategorySpend] = []
        for (id, b) in budgets where isSpend(id) {
            rows.append(CategorySpend(id: id, name: name(id, index), icon: index[id]?.icon,
                                      cents: b.spentCents, budget: b, partial: false))
        }
        for (id, cents) in fromTape {
            rows.append(CategorySpend(id: id, name: name(id, index), icon: index[id]?.icon,
                                      cents: cents, budget: nil, partial: true))
        }
        return rows.filter { $0.cents > 0 }.sorted { $0.cents > $1.cents }
    }

    /// This month's outflows for one category, newest first.
    static func categoryTxns(_ s: Summary, category: String, month: Month) -> [Summary.Txn] {
        s.recent
            .filter { $0.category == category && $0.cents < 0 && $0.ts >= month.startSec }
            .sorted { $0.ts > $1.ts }
    }
}

extension Int {
    /// Cents → dollars, for the shared money formatters.
    var dollars: Double { Double(self) / 100 }
}
