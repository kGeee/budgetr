import CoreData
import Foundation

/// A believable ledger, for exploring the app without one of your own.
///
/// A phone fresh from TestFlight has no `budgetr.db` on it, and an app whose
/// every screen says "import a file" can't be judged on anything but that
/// sentence. This seeds the same shape the importer produces — institutions,
/// accounts, the web app's category vocabulary, budgets, ~90 days of
/// transactions and a handful of recurring bills — so every screen has
/// something true-to-life to draw. It is flagged in `UserDefaults` and the
/// shell wears a ribbon the whole time it's loaded, so invented balances can
/// never pass for real ones.
enum SampleData {
    static let flagKey = "budgetr.sampleData"

    static var isLoaded: Bool { UserDefaults.standard.bool(forKey: flagKey) }

    /// The web app's seeded categories (web/lib/seed-categories-data.ts).
    private static let categories: [(plaid: String, name: String, icon: String, group: String)] = [
        ("INCOME", "Income", "Wallet", "income"),
        ("TRANSFER_IN", "Transfer In", "ArrowDownLeft", "transfer"),
        ("TRANSFER_OUT", "Transfer Out", "ArrowUpRight", "transfer"),
        ("LOAN_PAYMENTS", "Loan Payments", "Landmark", "transfer"),
        ("BANK_FEES", "Bank Fees", "Receipt", "spending"),
        ("ENTERTAINMENT", "Entertainment", "Clapperboard", "spending"),
        ("FOOD_AND_DRINK", "Food & Drink", "UtensilsCrossed", "spending"),
        ("GENERAL_MERCHANDISE", "Shopping", "ShoppingBag", "spending"),
        ("HOME_IMPROVEMENT", "Home", "Hammer", "spending"),
        ("MEDICAL", "Medical", "HeartPulse", "spending"),
        ("PERSONAL_CARE", "Personal Care", "Sparkles", "spending"),
        ("GENERAL_SERVICES", "Services", "Wrench", "spending"),
        ("GOVERNMENT_AND_NON_PROFIT", "Government & Charity", "Building2", "spending"),
        ("TRANSPORTATION", "Transportation", "Car", "spending"),
        ("TRAVEL", "Travel", "Plane", "spending"),
        ("RENT_AND_UTILITIES", "Rent & Utilities", "Plug", "spending"),
    ]

    private static let budgets: [String: Double] = [
        "FOOD_AND_DRINK": 650,
        "GENERAL_MERCHANDISE": 400,
        "ENTERTAINMENT": 120,
        "TRANSPORTATION": 220,
        "RENT_AND_UTILITIES": 2_350,
        "PERSONAL_CARE": 80,
    ]

    /// Merchant, Plaid primary, typical amount, and how many times a month.
    private static let merchants: [(String, String, Double, Double)] = [
        ("Blue Bottle Coffee", "FOOD_AND_DRINK", 6.5, 9),
        ("Whole Foods Market", "FOOD_AND_DRINK", 86, 4),
        ("Trader Joe's", "FOOD_AND_DRINK", 54, 3),
        ("Sweetgreen", "FOOD_AND_DRINK", 16, 4),
        ("Tartine Bakery", "FOOD_AND_DRINK", 21, 2),
        ("DoorDash", "FOOD_AND_DRINK", 38, 2),
        ("Amazon", "GENERAL_MERCHANDISE", 42, 3),
        ("Target", "GENERAL_MERCHANDISE", 64, 1.5),
        ("Muji", "GENERAL_MERCHANDISE", 35, 0.5),
        ("Uber", "TRANSPORTATION", 19, 3),
        ("Shell", "TRANSPORTATION", 52, 2),
        ("Clipper", "TRANSPORTATION", 30, 1),
        ("Alamo Drafthouse", "ENTERTAINMENT", 28, 1),
        ("Steam", "ENTERTAINMENT", 18, 0.6),
        ("Aesop", "PERSONAL_CARE", 48, 0.4),
        ("Walgreens", "MEDICAL", 22, 0.8),
        ("Home Depot", "HOME_IMPROVEMENT", 74, 0.6),
    ]

    /// Recurring bills: merchant, Plaid primary, amount, day of month.
    private static let bills: [(String, String, Double, Int, String)] = [
        ("Mission Street Apartments", "RENT_AND_UTILITIES", 2_150, 1, "MONTHLY"),
        ("PG&E", "RENT_AND_UTILITIES", 96, 12, "MONTHLY"),
        ("Netflix", "ENTERTAINMENT", 15.49, 7, "MONTHLY"),
        ("Spotify", "ENTERTAINMENT", 11.99, 19, "MONTHLY"),
        ("Equinox", "PERSONAL_CARE", 0, 3, "MONTHLY"),  // amount set below
        ("iCloud+", "GENERAL_SERVICES", 2.99, 22, "MONTHLY"),
        ("Comcast Xfinity", "RENT_AND_UTILITIES", 70, 15, "MONTHLY"),
    ]

    /// Seeds the store. Only ever runs against an empty one — the caller checks.
    static func load(into ctx: NSManagedObjectContext, now: Date = Date(), calendar: Calendar = .current) throws {
        var rng = SeededGenerator(seed: 0xB0D6E7)

        // Categories
        var catByPlaid: [String: CDCategory] = [:]
        for (i, c) in categories.enumerated() {
            let obj = CDCategory(context: ctx)
            obj.id = "cat_\(c.plaid.lowercased())"
            obj.name = c.name
            obj.icon = c.icon
            obj.group = c.group
            obj.plaidPrimary = c.plaid
            obj.sortOrder = Int64(i)
            obj.archived = false
            catByPlaid[c.plaid] = obj
        }
        for (plaid, amount) in budgets {
            let b = CDBudget(context: ctx)
            b.id = "budget_\(plaid.lowercased())"
            b.amount = amount
            b.category = catByPlaid[plaid]
        }

        // Institutions and accounts
        func item(_ id: String, _ name: String) -> CDItem {
            let it = CDItem(context: ctx)
            it.id = id
            it.institutionName = name
            it.status = "active"
            it.createdAt = now
            return it
        }
        func account(_ id: String, _ name: String, _ type: String, _ subtype: String, _ mask: String, _ balance: Double, _ item: CDItem) -> CDAccount {
            let a = CDAccount(context: ctx)
            a.id = id
            a.name = name
            a.type = type
            a.subtype = subtype
            a.mask = mask
            a.currentBalance = NSNumber(value: balance)
            a.isoCurrencyCode = "USD"
            a.item = item
            a.updatedAt = now
            return a
        }
        let chase = item("item_chase", "Chase")
        let amex = item("item_amex", "American Express")
        let fidelity = item("item_fidelity", "Fidelity")
        let checking = account("acc_checking", "Total Checking", "depository", "checking", "4417", 6_842.19, chase)
        _ = account("acc_savings", "Premier Savings", "depository", "savings", "9032", 24_310.55, chase)
        let card = account("acc_gold", "Gold Card", "credit", "credit card", "1008", 1_486.72, amex)
        _ = account("acc_brokerage", "Individual Brokerage", "investment", "brokerage", "7781", 58_920.40, fidelity)
        _ = account("acc_roth", "Roth IRA", "investment", "roth", "2290", 31_455.08, fidelity)

        // Transactions — ~90 days back, the most recent fortnight left
        // unreviewed so the Review queue has something in it.
        let start = calendar.date(byAdding: .day, value: -92, to: now) ?? now
        var n = 0
        func txn(_ merchant: String, _ plaid: String, _ amount: Double, _ date: Date, account: CDAccount, pending: Bool = false) {
            n += 1
            let t = CDTransaction(context: ctx)
            t.id = "sample_txn_\(n)"
            t.merchantName = merchant
            t.name = merchant.uppercased()
            t.category = plaid
            t.amount = (amount * 100).rounded() / 100
            t.date = MonthSummary.dayKey(date, calendar: calendar)
            t.isoCurrencyCode = "USD"
            t.pending = pending
            t.account = account
            let age = calendar.dateComponents([.day], from: date, to: now).day ?? 0
            t.reviewed = age > 13 || rng.chance(0.35)
        }

        var day = start
        while day <= now {
            let dom = calendar.component(.day, from: day)
            let isToday = calendar.isDate(day, inSameDayAs: now)

            for (merchant, plaid, typical, perMonth) in merchants where rng.chance(perMonth / 30) {
                let amount = typical * rng.range(0.6, 1.45)
                txn(merchant, plaid, amount, day, account: rng.chance(0.7) ? card : checking, pending: isToday)
            }
            for (merchant, plaid, amount, billDay, _) in bills where billDay == dom {
                let value = merchant == "Equinox" ? 205 : amount
                txn(merchant, plaid, value, day, account: plaid == "RENT_AND_UTILITIES" ? checking : card)
            }
            if dom == 1 || dom == 15 {
                txn("Acme Corp Payroll", "INCOME", -4_120, day, account: checking)
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }

        // Recurring streams, predicted from the bills above.
        for (i, bill) in bills.enumerated() {
            let (merchant, plaid, amount, billDay, frequency) = bill
            let value = merchant == "Equinox" ? 205 : amount
            let s = CDRecurringStream(context: ctx)
            s.id = "sample_stream_\(i)"
            s.merchantName = merchant
            s.streamDescription = merchant
            s.category = plaid
            s.direction = "outflow"
            s.frequency = frequency
            s.averageAmount = NSNumber(value: value)
            s.lastAmount = NSNumber(value: value)
            s.isoCurrencyCode = "USD"
            s.isActive = true
            s.status = "MATURE"
            s.account = checking
            s.updatedAt = now
            let next = nextDate(day: billDay, after: now, calendar: calendar)
            s.predictedNextDate = MonthSummary.dayKey(next, calendar: calendar)
            if let last = calendar.date(byAdding: .month, value: -1, to: next) {
                s.lastDate = MonthSummary.dayKey(last, calendar: calendar)
            }
        }
        // One that slipped, so "Overdue" is demonstrated rather than described.
        if let late = calendar.date(byAdding: .day, value: -3, to: now) {
            let s = CDRecurringStream(context: ctx)
            s.id = "sample_stream_late"
            s.merchantName = "State Farm"
            s.streamDescription = "State Farm"
            s.category = "GENERAL_SERVICES"
            s.direction = "outflow"
            s.frequency = "MONTHLY"
            s.averageAmount = NSNumber(value: 128.4)
            s.isoCurrencyCode = "USD"
            s.isActive = true
            s.account = checking
            s.predictedNextDate = MonthSummary.dayKey(late, calendar: calendar)
        }

        try ctx.save()
        UserDefaults.standard.set(true, forKey: flagKey)
    }

    private static func nextDate(day: Int, after now: Date, calendar: Calendar) -> Date {
        var c = calendar.dateComponents([.year, .month], from: now)
        c.day = day
        let thisMonth = calendar.date(from: c) ?? now
        if thisMonth >= calendar.startOfDay(for: now) { return thisMonth }
        return calendar.date(byAdding: .month, value: 1, to: thisMonth) ?? thisMonth
    }
}

/// Wipes the local store — the way out of sample data, and a clean slate before
/// importing a different ledger.
enum DataReset {
    static func eraseAll(in ctx: NSManagedObjectContext) throws {
        let names = ctx.persistentStoreCoordinator?.managedObjectModel.entities.compactMap(\.name) ?? []
        for name in names {
            let request = NSFetchRequest<NSManagedObject>(entityName: name)
            request.includesPropertyValues = false
            for obj in try ctx.fetch(request) { ctx.delete(obj) }
        }
        if ctx.hasChanges { try ctx.save() }
        UserDefaults.standard.set(false, forKey: SampleData.flagKey)
    }
}

/// Deterministic randomness, so the sample ledger is the same on every device
/// and a screenshot taken today matches one taken tomorrow (shifted by a day).
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) { state = seed == 0 ? 0x9E37_79B9_7F4A_7C15 : seed }

    mutating func next() -> UInt64 {
        // xorshift64*
        state ^= state >> 12
        state ^= state << 25
        state ^= state >> 27
        return state &* 0x2545_F491_4F6C_DD1D
    }

    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
    mutating func chance(_ p: Double) -> Bool { unit() < p }
    mutating func range(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * unit() }
}
