import XCTest

/// The fixed / flexible split and the pace sentence. These pin the phone to
/// the desktop's reading (web/lib/budget-verdict.test.ts uses the same cases).
final class BudgetPaceTests: XCTestCase {
    private func position(fixed: (Int, Int) = (0, 0), flexible: (Int, Int)) -> CompanionModel.BudgetPosition {
        .init(fixedSpent: fixed.0, fixedLimit: fixed.1, flexibleSpent: flexible.0, flexibleLimit: flexible.1)
    }

    func testNoBudgetSaysNothing() {
        XCTAssertNil(CompanionModel.paceVerdict(position(flexible: (5_000, 0)), dayOfMonth: 15, daysInMonth: 31))
    }

    func testUnderAnEvenPaceMidMonth() {
        // Day 15 of 31 → an even burn of $3,100 is $1,500 so far.
        let v = CompanionModel.paceVerdict(position(flexible: (100_000, 310_000)), dayOfMonth: 15, daysInMonth: 31)
        XCTAssertEqual(v?.tone, .ok)
        XCTAssertEqual(v?.lead, "Spending is")
        XCTAssertEqual(v?.cents, 50_000)
        XCTAssertEqual(v?.tail, "under an even pace, with 16 days left.")
    }

    func testAheadOfPace() {
        let v = CompanionModel.paceVerdict(position(flexible: (200_000, 310_000)), dayOfMonth: 15, daysInMonth: 31)
        XCTAssertEqual(v?.tone, .warn)
        XCTAssertEqual(v?.cents, 50_000)
    }

    func testFixedBudgetsAreLeftOutOfPace() {
        // Rent paid on the 1st puts the whole month "ahead"; flexible alone is
        // 417.27 against 2530 × 15/31 = 1224.19 — comfortably under.
        let p = position(fixed: (261_758, 280_000), flexible: (41_727, 253_000))
        XCTAssertTrue(p.judgesFlexible)
        XCTAssertEqual(p.left, 229_515)
        let v = CompanionModel.paceVerdict(p, dayOfMonth: 15, daysInMonth: 31)
        XCTAssertEqual(v?.tone, .ok)
        XCTAssertEqual(v?.lead, "Flexible spending is")
        XCTAssertEqual(v?.cents, 122_419 - 41_727)

        let whole = position(flexible: (303_485, 533_000))
        XCTAssertEqual(CompanionModel.paceVerdict(whole, dayOfMonth: 15, daysInMonth: 31)?.tone, .warn)
    }

    func testAnOverspentFixedBillDoesNotColourFlexible() {
        let v = CompanionModel.paceVerdict(
            position(fixed: (300_000, 280_000), flexible: (40_000, 253_000)), dayOfMonth: 15, daysInMonth: 31)
        XCTAssertEqual(v?.tone, .ok)
    }

    func testOverBudgetAndClosedMonth() {
        let over = CompanionModel.paceVerdict(position(flexible: (325_000, 310_000)), dayOfMonth: 30, daysInMonth: 31)
        XCTAssertEqual(over?.tone, .over)
        XCTAssertEqual(over?.cents, 15_000)
        XCTAssertEqual(over?.tail, "over budget with 1 day left.")

        let closed = CompanionModel.paceVerdict(position(flexible: (300_000, 310_000)), dayOfMonth: 31, daysInMonth: 31)
        XCTAssertEqual(closed?.lead, "The month closed")
        XCTAssertEqual(closed?.cents, 10_000)
    }

    func testEveryBudgetFixedFallsBackToTheWholeMonth() {
        let p = position(fixed: (100_000, 280_000), flexible: (0, 0))
        XCTAssertFalse(p.judgesFlexible)
        XCTAssertEqual(CompanionModel.paceVerdict(p, dayOfMonth: 15, daysInMonth: 31)?.lead, "Spending is")
    }

    func testAFixedFlagDecodesAndOlderPayloadsStillDo() throws {
        let json = #"[{"category":"cat_rent","spentCents":1,"limitCents":2,"state":"ok","fixed":true},{"category":"cat_food","spentCents":1,"limitCents":2,"state":"ok"}]"#
        let budgets = try JSONDecoder().decode([Summary.Budget].self, from: Data(json.utf8))
        XCTAssertTrue(budgets[0].isFixed)
        XCTAssertFalse(budgets[1].isFixed)
    }
}
