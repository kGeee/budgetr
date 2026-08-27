import XCTest

final class CategorySpendTests: XCTestCase {

    private func line(
        _ amount: Double,
        _ date: String,
        user: String? = nil,
        plaid: String? = nil
    ) -> CategorySpend.Line {
        CategorySpend.Line(amount: amount, date: date, userCategoryId: user, plaidPrimary: plaid)
    }

    func testOverrideWinsOverPlaidMapping() {
        let map = ["FOOD_AND_DRINK": "cat_food"]
        let groups = ["cat_user": "spending", "cat_food": "spending"]
        let totals = CategorySpend.totals(
            lines: [line(42, "2026-08-05", user: "cat_user", plaid: "FOOD_AND_DRINK")],
            month: "2026-08",
            plaidPrimaryToCategoryId: map,
            categoryGroupById: groups
        )
        XCTAssertEqual(CategorySpend.spent(for: "cat_user", in: totals), 42, accuracy: 0.001)
        XCTAssertNil(totals["cat_food"])
    }

    func testFallsBackToPlaidPrimaryWhenNoOverride() {
        let map = ["FOOD_AND_DRINK": "cat_food"]
        let groups = ["cat_food": "spending"]
        let totals = CategorySpend.totals(
            lines: [line(18.50, "2026-08-12", plaid: "FOOD_AND_DRINK")],
            month: "2026-08",
            plaidPrimaryToCategoryId: map,
            categoryGroupById: groups
        )
        XCTAssertEqual(CategorySpend.spent(for: "cat_food", in: totals), 18.50, accuracy: 0.001)
    }

    func testIgnoresInflowsAndOtherMonths() {
        let totals = CategorySpend.totals(
            lines: [
                line(100, "2026-08-01"),
                line(-2_000, "2026-08-15"), // salary — not spend
                line(50, "2026-07-31"),     // prior month
            ],
            month: "2026-08",
            plaidPrimaryToCategoryId: [:]
        )
        XCTAssertEqual(CategorySpend.spent(for: "__none__", in: totals), 100, accuracy: 0.001)
    }

    func testBudgetsAndCategoriesWouldAgree() {
        // Two rows that old BudgetsView (userCategory-only) would split apart.
        let map = ["FOOD_AND_DRINK": "cat_food"]
        let groups = ["cat_food": "spending"]
        let lines = [
            line(30, "2026-08-03", user: "cat_food"),
            line(20, "2026-08-07", plaid: "FOOD_AND_DRINK"),
        ]
        let totals = CategorySpend.totals(
            lines: lines,
            month: "2026-08",
            plaidPrimaryToCategoryId: map,
            categoryGroupById: groups
        )
        XCTAssertEqual(CategorySpend.spent(for: "cat_food", in: totals), 50, accuracy: 0.001)
    }

    func testTransferPlaidPrimariesAreNotSpend() {
        // Unmapped TRANSFER_OUT must not inflate "where it went".
        let totals = CategorySpend.totals(
            lines: [
                line(80, "2026-08-04", plaid: "FOOD_AND_DRINK"),
                line(500, "2026-08-05", plaid: "TRANSFER_OUT"),
                line(200, "2026-08-06", plaid: "TRANSFER_IN"),
                line(90, "2026-08-07", plaid: "LOAN_PAYMENTS"),
            ],
            month: "2026-08",
            plaidPrimaryToCategoryId: ["FOOD_AND_DRINK": "cat_food"],
            categoryGroupById: ["cat_food": "spending"]
        )
        XCTAssertEqual(CategorySpend.spent(for: "cat_food", in: totals), 80, accuracy: 0.001)
        XCTAssertEqual(totals.values.reduce(0, +), 80, accuracy: 0.001)
    }

    func testReimbursableTransferGroupIsNotSpend() {
        // Reimbursable is seeded with group=transfer and no Plaid primary —
        // the group filter is what drops it, same as web.
        let groups = [
            "cat_food": "spending",
            "cat_reimbursable": "transfer",
            "cat_transfer_out": "transfer",
        ]
        let map = ["TRANSFER_OUT": "cat_transfer_out", "FOOD_AND_DRINK": "cat_food"]
        let totals = CategorySpend.totals(
            lines: [
                line(40, "2026-08-02", user: "cat_food"),
                line(120, "2026-08-03", user: "cat_reimbursable"),
                line(300, "2026-08-04", plaid: "TRANSFER_OUT"),
            ],
            month: "2026-08",
            plaidPrimaryToCategoryId: map,
            categoryGroupById: groups
        )
        XCTAssertEqual(CategorySpend.spent(for: "cat_food", in: totals), 40, accuracy: 0.001)
        XCTAssertNil(totals["cat_reimbursable"])
        XCTAssertNil(totals["cat_transfer_out"])
    }

    func testOverrideIntoSpendingCountsEvenIfPlaidWasTransfer() {
        // User filed a TRANSFER_OUT as Dining — that is real spend.
        let totals = CategorySpend.totals(
            lines: [line(55, "2026-08-08", user: "cat_food", plaid: "TRANSFER_OUT")],
            month: "2026-08",
            plaidPrimaryToCategoryId: ["TRANSFER_OUT": "cat_transfer_out"],
            categoryGroupById: ["cat_food": "spending", "cat_transfer_out": "transfer"]
        )
        XCTAssertEqual(CategorySpend.spent(for: "cat_food", in: totals), 55, accuracy: 0.001)
    }
}

final class BudgetUtilisationTests: XCTestCase {

    func testWarnAt85Percent() {
        XCTAssertEqual(BudgetUtilisation.classify(spent: 85, limit: 100), .warn)
        XCTAssertEqual(BudgetUtilisation.classify(spent: 84.9, limit: 100), .ok)
    }

    func testOverAtLimit() {
        XCTAssertEqual(BudgetUtilisation.classify(spent: 100, limit: 100), .over)
        XCTAssertEqual(BudgetUtilisation.classify(spent: 120, limit: 100), .over)
    }

    func testMultiplierLabelsOverflow() {
        XCTAssertEqual(BudgetUtilisation.multiplierLabel(spent: 130, limit: 100), "1.3×")
        XCTAssertEqual(BudgetUtilisation.multiplierLabel(spent: 1_000, limit: 100), "10×")
        XCTAssertNil(BudgetUtilisation.multiplierLabel(spent: 90, limit: 100))
    }
}
