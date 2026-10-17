#if DEBUG
import Foundation

/// A believable Summary for working on the paired screens without a Mac on the
/// other end. Debug builds only, and only when launched with
/// `-companion-demo` — it never touches the Keychain or the summary cache, so
/// relaunching without the flag returns the app to whatever it really was.
enum CompanionDemo {
    static var isActive: Bool { ProcessInfo.processInfo.arguments.contains("-companion-demo") }

    static func make(now: Date = Date()) -> Summary {
        var rng = SeededRandom(seed: 42)
        let cal = CompanionModel.utc
        let today = cal.startOfDay(for: now)
        let todaySec = Int(today.timeIntervalSince1970)
        let day = 86_400

        let categories: [Summary.Category] = [
            .init(id: "INCOME", name: "Income", icon: "Wallet", group: "income"),
            .init(id: "FOOD_AND_DRINK", name: "Food & Drink", icon: "UtensilsCrossed", group: "spending"),
            .init(id: "GENERAL_MERCHANDISE", name: "Shopping", icon: "ShoppingBag", group: "spending"),
            .init(id: "TRANSPORTATION", name: "Transportation", icon: "Car", group: "spending"),
            .init(id: "RENT_AND_UTILITIES", name: "Rent & Utilities", icon: "Plug", group: "spending"),
            .init(id: "ENTERTAINMENT", name: "Entertainment", icon: "Clapperboard", group: "spending"),
            .init(id: "PERSONAL_CARE", name: "Personal Care", icon: "Sparkles", group: "spending"),
            .init(id: "TRAVEL", name: "Travel", icon: "Plane", group: "spending"),
            .init(id: "MEDICAL", name: "Medical", icon: "HeartPulse", group: "spending"),
            .init(id: "TRANSFER_OUT", name: "Transfer Out", icon: "ArrowUpRight", group: "transfer"),
            .init(id: "TRANSFER_IN", name: "Transfer In", icon: "ArrowDownLeft", group: "transfer"),
            .init(id: "LOAN_PAYMENTS", name: "Loan Payments", icon: "Landmark", group: "transfer"),
            .init(id: "cat_reimbursable", name: "Reimbursable", icon: "Users", group: "transfer"),
        ]

        let merchants: [(String, String, ClosedRange<Int>)] = [
            ("Blue Bottle Coffee", "FOOD_AND_DRINK", 450...1_200),
            ("Whole Foods Market", "FOOD_AND_DRINK", 2_800...14_500),
            ("Sweetgreen", "FOOD_AND_DRINK", 1_400...2_200),
            ("Tartine Bakery", "FOOD_AND_DRINK", 900...2_600),
            ("Amazon", "GENERAL_MERCHANDISE", 1_500...8_900),
            ("Target", "GENERAL_MERCHANDISE", 2_200...9_600),
            ("Uber", "TRANSPORTATION", 1_100...3_800),
            ("Shell", "TRANSPORTATION", 3_800...6_200),
            ("Netflix", "ENTERTAINMENT", 1_549...1_549),
            ("AMC Theatres", "ENTERTAINMENT", 1_800...4_200),
            ("Aesop", "PERSONAL_CARE", 3_500...7_500),
            ("Delta Air Lines", "TRAVEL", 18_000...42_000),
            ("CVS Pharmacy", "MEDICAL", 900...3_400),
        ]

        // Ninety days of spend, a touch heavier at weekends.
        var spendByDay: [Summary.SparkPoint] = []
        for back in stride(from: 90, through: 0, by: -1) {
            let d = todaySec - back * day
            let weekday = cal.component(.weekday, from: Date(timeIntervalSince1970: TimeInterval(d)))
            let weekend = weekday == 1 || weekday == 7
            let quiet = rng.next(100) < 12
            let cents = quiet ? 0 : rng.next(in: weekend ? 6_000...22_000 : 2_000...11_000)
            spendByDay.append(.init(d: d, cents: cents))
        }

        // The recent tape: ~40, newest first.
        var recent: [Summary.Txn] = []
        var t = Int(now.timeIntervalSince1970) - 1_800
        for i in 0..<40 {
            if i == 6 {
                recent.append(.init(id: "pay", ts: t, merchant: "Acme Corp Payroll", cents: 412_500, category: "INCOME", pending: false))
            } else if i == 19 {
                recent.append(.init(id: "rent", ts: t, merchant: "Parkline Apartments", cents: -245_000, category: "RENT_AND_UTILITIES", pending: false))
            } else if i == 10 {
                // A card payment and its card-side twin: money moving, not spent.
                recent.append(.init(id: "amex", ts: t, merchant: "AMERICAN EXPRESS ACH PMT", cents: -642_116, category: "LOAN_PAYMENTS", pending: false))
            } else if i == 11 {
                recent.append(.init(id: "amex-cr", ts: t + 60, merchant: "AUTOPAY PAYMENT - THANK YOU", cents: 642_116, category: "LOAN_PAYMENTS", pending: false))
            } else if i == 4 {
                recent.append(.init(id: "venmo", ts: t, merchant: "Venmo · Maya Chen", cents: 6_450, category: "TRANSFER_IN", pending: false))
            } else if i == 3 {
                // Matches the sample receipt used to try itemized splitting.
                recent.append(.init(id: "tartine", ts: t, merchant: "Tartine Bakery", cents: -6_974, category: "FOOD_AND_DRINK", pending: false))
            } else if i == 8 {
                recent.append(.init(id: "ippudo", ts: t, merchant: "Ippudo", cents: -18_640, category: "FOOD_AND_DRINK", pending: false))
            } else if i == 25 {
                recent.append(.init(id: "pge", ts: t, merchant: "PG&E", cents: -11_842, category: "RENT_AND_UTILITIES", pending: false))
            } else {
                let m = merchants[rng.next(merchants.count)]
                recent.append(.init(id: "t\(i)", ts: t, merchant: m.0, cents: -rng.next(in: m.2), category: m.1, pending: i < 3))
            }
            t -= rng.next(in: 3_000...28_000)
        }

        let month = CompanionModel.Month(now: now)
        let elapsed = Double(month.dayOfMonth) / Double(month.daysInMonth)
        func budget(_ cat: String, _ limit: Int, _ pace: Double) -> Summary.Budget {
            let spent = Int(Double(limit) * elapsed * pace)
            let state = spent > limit ? "over" : pace > 1.08 ? "warn" : "ok"
            return .init(category: cat, spentCents: spent, limitCents: limit, state: state)
        }
        let budgets = [
            budget("FOOD_AND_DRINK", 65_000, 1.18),
            budget("GENERAL_MERCHANDISE", 40_000, 0.74),
            budget("TRANSPORTATION", 22_000, 0.92),
            budget("RENT_AND_UTILITIES", 270_000, 1.0),
            budget("ENTERTAINMENT", 12_000, 1.9),
            budget("PERSONAL_CARE", 9_000, 0.4),
        ]

        var netSpark: [Summary.SparkPoint] = []
        var worth = 18_420_000
        for back in stride(from: 60, through: 0, by: -1) {
            worth += rng.next(in: -180_000...240_000)
            netSpark.append(.init(d: todaySec - back * day, cents: worth))
        }
        var invSpark: [Summary.SparkPoint] = []
        var inv = 9_650_000
        for back in stride(from: 60, through: 0, by: -1) {
            inv += rng.next(in: -150_000...190_000)
            invSpark.append(.init(d: todaySec - back * day, cents: inv))
        }

        let positions: [Summary.Position] = [
            .init(symbol: "VTI", cents: 4_182_300, name: "Vanguard Total Stock Market", dayBp: 64, pnlCents: 812_000, qtyLabel: "142", sector: "Index fund"),
            .init(symbol: "AAPL", cents: 1_904_550, name: "Apple Inc.", dayBp: -118, pnlCents: 402_000, qtyLabel: "82", sector: "Technology"),
            .init(symbol: "VXUS", cents: 1_288_000, name: "Vanguard Total International", dayBp: 31, pnlCents: 98_000, qtyLabel: "198", sector: "Index fund"),
            .init(symbol: "NVDA", cents: 1_120_400, name: "NVIDIA Corp.", dayBp: 241, pnlCents: 655_000, qtyLabel: "61", sector: "Technology"),
            .init(symbol: "BND", cents: 760_200, name: "Vanguard Total Bond Market", dayBp: -9, pnlCents: -21_000, qtyLabel: "105", sector: "Bonds"),
            .init(symbol: "JPM", cents: 412_900, name: "JPMorgan Chase & Co.", dayBp: 87, pnlCents: 61_000, qtyLabel: "17", sector: "Financials"),
            .init(symbol: "BTC-USD", cents: 388_000, name: "Bitcoin", dayBp: -312, pnlCents: 140_000, qtyLabel: "0.04", sector: "Crypto"),
        ]
        let sectorTotals = Dictionary(grouping: positions, by: { $0.sector ?? "Other" })
            .map { Summary.Sector(sector: $0.key, cents: $0.value.reduce(0) { $0 + $1.cents }) }
            .sorted { $0.cents > $1.cents }

        return Summary(
            v: SummaryContract.version,
            asOf: Int(now.timeIntervalSince1970) - 240,
            appliedOpIds: [],
            netWorth: .init(cents: worth, spark: netSpark),
            accounts: [
                .init(id: "chk", name: "Everyday Checking", kind: "depository", cents: 842_317),
                .init(id: "sav", name: "High-Yield Savings", kind: "depository", cents: 2_450_000),
                .init(id: "brk", name: "Brokerage", kind: "investment", cents: inv),
                .init(id: "ira", name: "Roth IRA", kind: "investment", cents: 6_120_000),
                .init(id: "cc1", name: "Sapphire Reserve", kind: "credit", cents: -284_190),
                .init(id: "cc2", name: "Apple Card", kind: "credit", cents: -61_204),
                .init(id: "car", name: "Auto Loan", kind: "loan", cents: -1_412_000),
            ],
            budgets: budgets,
            recent: recent,
            positions: positions,
            alerts: [
                .init(id: "a1", kind: "connection", text: "Chase needs you to sign in again — balances haven't updated in 3 days.", ts: todaySec - 3 * day),
            ],
            investments: .init(valueCents: positions.reduce(0) { $0 + $1.cents }, spark: invSpark, sectors: sectorTotals),
            spendByDay: spendByDay,
            categories: categories,
            people: [
                .init(id: "p-maya", name: "Maya Chen", color: "#6FE3A6", cents: 12_840, openCount: 3, lastSettledAt: todaySec - 9 * day, handle: "@maya-chen"),
                .init(id: "p-jordan", name: "Jordan Ali", color: "#7FB2E0", cents: 8_215, openCount: 2, lastSettledAt: nil, handle: "@jordanali"),
                .init(id: "p-sam", name: "Sam Rivera", color: "#E0C36F", cents: -4_200, openCount: 1, lastSettledAt: todaySec - 30 * day, handle: nil),
                .init(id: "p-priya", name: "Priya Patel", color: "#B59CE0", cents: 0, openCount: 0, lastSettledAt: todaySec - 2 * day, handle: "@priya-p"),
            ],
            shared: [
                .init(id: "s1", txnId: "ippudo", ts: todaySec - 1 * day, merchant: "Ippudo", cents: 18_640, myCents: 6_190,
                      shares: [.init(personId: "p-maya", cents: 6_450), .init(personId: "p-jordan", cents: 6_000)], itemized: true, note: "Friday ramen"),
                .init(id: "s2", txnId: "t-airbnb", ts: todaySec - 4 * day, merchant: "Airbnb · Big Sur", cents: 84_000, myCents: 28_000,
                      shares: [.init(personId: "p-maya", cents: 28_000), .init(personId: "p-sam", cents: 28_000)], itemized: false, note: "Cabin weekend"),
                .init(id: "s3", txnId: "t-tickets", ts: todaySec - 6 * day, merchant: "Ticketmaster", cents: 24_630, myCents: 8_210,
                      shares: [.init(personId: "p-jordan", cents: 8_210), .init(personId: "p-maya", cents: 8_210)], itemized: false, note: nil),
                .init(id: "s4", txnId: "t-uber", ts: todaySec - 11 * day, merchant: "Uber", cents: 4_820, myCents: 2_410,
                      shares: [.init(personId: "p-priya", cents: 2_410)], itemized: false, note: nil),
                .init(id: "s5", txnId: "t-groceries", ts: todaySec - 15 * day, merchant: "Whole Foods Market", cents: 12_600, myCents: 4_200,
                      shares: [.init(personId: "p-sam", cents: 4_200), .init(personId: "p-maya", cents: 4_200)], itemized: true, note: "BBQ supplies"),
            ],
            settleSuggestions: [
                .init(txnId: "venmo", personId: "p-maya", ts: todaySec - day / 2, cents: 6_450, detail: "Venmo · matches their Ippudo share"),
            ]
        )
    }
}

/// Deterministic, so every demo launch draws the same screens.
private struct SeededRandom {
    private var state: UInt64

    init(seed: UInt64) { state = seed &* 0x9E37_79B9_7F4A_7C15 }

    mutating func next(_ upper: Int) -> Int {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return Int((state >> 33) % UInt64(max(1, upper)))
    }

    mutating func next(in range: ClosedRange<Int>) -> Int {
        range.lowerBound + next(range.upperBound - range.lowerBound + 1)
    }
}
#endif
