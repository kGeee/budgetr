import XCTest

/// The dashboard's arithmetic.
///
/// This layer exists to agree with the web app to the cent, so the tests are
/// written the way the migration plan asks for: fixtures with known answers,
/// not "does it compile and look plausible".
///
/// Sign convention throughout is Plaid's, which is the web app's: **positive is
/// money leaving the account**.
final class MonthSummaryTests: XCTestCase {

    private func entry(_ amount: Double, _ date: String, _ category: String? = nil) -> MonthSummary.Entry {
        MonthSummary.Entry(amount: amount, date: date, categoryId: category, pending: false)
    }

    // ── Spend ────────────────────────────────────────────────────────

    func testSpentCountsOutflowsOnly() {
        // Payday must not reduce "spent this month" — otherwise the headline
        // figure drops on the 15th for reasons that have nothing to do with
        // spending.
        let entries = [
            entry(100, "2026-08-03"),
            entry(-2_000, "2026-08-15"),   // salary
            entry(45.50, "2026-08-17"),
        ]
        XCTAssertEqual(MonthSummary.spent(entries), 145.50, accuracy: 0.001)
    }

    func testSpentIsZeroForAnEmptyMonth() {
        XCTAssertEqual(MonthSummary.spent([]), 0)
    }

    // ── Windowing ────────────────────────────────────────────────────

    func testMonthKeyIsZeroPadded() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let jan = cal.date(from: DateComponents(year: 2026, month: 1, day: 9))!
        XCTAssertEqual(MonthSummary.monthKey(of: jan, calendar: cal), "2026-01")
    }

    func testInMonthMatchesOnTheStoredString() {
        // Dates are matched as text on purpose. The web app stores plain
        // calendar dates with no timezone; parsing them to instants slides a
        // transaction into the previous month for anyone west of UTC, which is
        // a month-boundary bug that only shows up for some users.
        let entries = [
            entry(10, "2026-07-31"),
            entry(20, "2026-08-01"),
            entry(30, "2026-08-31"),
            entry(40, "2026-09-01"),
        ]
        let august = MonthSummary.inMonth(entries, month: "2026-08")
        XCTAssertEqual(august.count, 2)
        XCTAssertEqual(MonthSummary.spent(august), 50, accuracy: 0.001)
    }

    // ── Like-for-like comparison ─────────────────────────────────────

    func testPriorMonthStopsAtTheSameDayOfMonth() {
        // Comparing a part-finished month against a whole one is the mistake
        // this guards: on the 8th you would always look "down" on last month.
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let now = cal.date(from: DateComponents(year: 2026, month: 8, day: 10))!

        let entries = [
            entry(100, "2026-07-05"),
            entry(200, "2026-07-10"),   // on the cutoff — counted
            entry(999, "2026-07-25"),   // after it — not
            entry(50, "2026-08-02"),
        ]
        XCTAssertEqual(
            MonthSummary.priorMonthToDate(entries, now: now, calendar: cal),
            300, accuracy: 0.001
        )
    }

    func testDeltaIsNilWithNothingToCompareTo() {
        XCTAssertNil(MonthSummary.deltaPct(spent: 500, prior: 0))
    }

    func testDeltaMatchesTheRealAccount() {
        // The figures the web app produced for August 2026 on the live database.
        // Both implementations were run over the same 834 transactions.
        let delta = MonthSummary.deltaPct(spent: 7_467.87, prior: 6_702.69)
        XCTAssertEqual(delta!, 11.42, accuracy: 0.01)
    }

    // ── Grouping ─────────────────────────────────────────────────────

    func testByDayIsAscendingAndSkipsEmptyDays() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let days = MonthSummary.byDay([
            entry(30, "2026-08-03"),
            entry(10, "2026-08-01"),
            entry(5, "2026-08-01"),
            entry(-99, "2026-08-02"),   // inflow only — no bar for that day
        ], calendar: cal)

        XCTAssertEqual(days.map(\.id), ["2026-08-01", "2026-08-03"])
        XCTAssertEqual(days.first!.spent, 15, accuracy: 0.001)
    }

    func testByCategoryRanksAndFoldsTheTail() {
        let entries = (1...9).map { entry(Double($0) * 10, "2026-08-0\($0)", "c\($0)") }
        let names = Dictionary(uniqueKeysWithValues: (1...9).map { ("c\($0)", "Cat \($0)") })
        let rows = MonthSummary.byCategory(entries, names: names, limit: 3)

        // Top three by value, then one honest bucket — never a silent truncation.
        XCTAssertEqual(rows.map(\.name), ["Cat 9", "Cat 8", "Cat 7", "Everything else"])
        XCTAssertEqual(rows.last!.spent, 10 + 20 + 30 + 40 + 50 + 60, accuracy: 0.001)
        XCTAssertEqual(rows.reduce(0) { $0 + $1.spent }, MonthSummary.spent(entries), accuracy: 0.001)
    }

    func testUncategorisedIsOneBucket() {
        // The bug this catches: grouping on the raw stored value put overridden
        // and un-overridden rows of the same category in different buckets, and
        // rendered as several identical "Uncategorised" bars.
        let rows = MonthSummary.byCategory([
            entry(10, "2026-08-01", nil),
            entry(20, "2026-08-02", nil),
        ], names: [:])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].spent, 30, accuracy: 0.001)
    }
}

/// The pace maths already in the app, pinned so a refactor can't quietly change
/// what "over pace" means.
final class BudgetPacingTests: XCTestCase {

    func testExpectedSpendIsStraightLine() {
        let p = BudgetPacing(totalBudget: 3_100, spentToDate: 0, dayOfMonth: 10, daysInMonth: 31)
        XCTAssertEqual(p.expectedToDate, 1_000, accuracy: 0.001)
    }

    func testAheadOfPaceMeansSpendingTooFast() {
        let p = BudgetPacing(totalBudget: 3_100, spentToDate: 1_500, dayOfMonth: 10, daysInMonth: 31)
        XCTAssertTrue(p.isAheadOfPace)
        XCTAssertEqual(p.paceDelta, 500, accuracy: 0.001)
        XCTAssertEqual(p.projectedMonthEnd, 4_650, accuracy: 0.001)
    }

    func testDayZeroDoesNotDivideByZero() {
        let p = BudgetPacing(totalBudget: 1_000, spentToDate: 0, dayOfMonth: 0, daysInMonth: 30)
        XCTAssertEqual(p.projectedMonthEnd, 0)
    }
}

final class CategoryMappingTests: XCTestCase {

    func testOverrideWinsOverPlaid() {
        let id = CategoryMapping.resolvedCategoryId(
            userCategoryId: "cat_user",
            plaidPrimary: "FOOD_AND_DRINK",
            categoryIdForPlaidPrimary: { _ in "cat_food" }
        )
        XCTAssertEqual(id, "cat_user")
    }

    func testFallsBackToThePlaidMapping() {
        let id = CategoryMapping.resolvedCategoryId(
            userCategoryId: nil,
            plaidPrimary: "FOOD_AND_DRINK",
            categoryIdForPlaidPrimary: { $0 == "FOOD_AND_DRINK" ? "cat_food" : nil }
        )
        XCTAssertEqual(id, "cat_food")
    }

    func testTransfersAreExcludedFromCashflow() {
        XCTAssertFalse(CategoryMapping.countsTowardCashflow(plaidPrimary: "TRANSFER_IN"))
        XCTAssertTrue(CategoryMapping.countsTowardCashflow(plaidPrimary: "FOOD_AND_DRINK"))
    }

    func testTransferGroupAndReimbursableAreNotSpend() {
        // Web skips group = 'transfer'; Reimbursable is seeded in that group.
        XCTAssertFalse(CategoryMapping.countsTowardSpend(
            resolvedGroup: "transfer",
            plaidPrimary: nil
        ))
        XCTAssertFalse(CategoryMapping.countsTowardSpend(
            resolvedGroup: nil,
            plaidPrimary: "TRANSFER_OUT"
        ))
        XCTAssertTrue(CategoryMapping.countsTowardSpend(
            resolvedGroup: "spending",
            plaidPrimary: "TRANSFER_OUT"
        ))
    }

    func testHumanisedNames() {
        XCTAssertEqual(CategoryMapping.humanise("FOOD_AND_DRINK"), "Food and drink")
        XCTAssertEqual(CategoryMapping.humanise("RENT"), "Rent")
    }
}
