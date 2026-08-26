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
        let totals = CategorySpend.totals(
            lines: [line(42, "2026-08-05", user: "cat_user", plaid: "FOOD_AND_DRINK")],
            month: "2026-08",
            plaidPrimaryToCategoryId: map
        )
        XCTAssertEqual(CategorySpend.spent(for: "cat_user", in: totals), 42, accuracy: 0.001)
        XCTAssertNil(totals["cat_food"])
    }

    func testFallsBackToPlaidPrimaryWhenNoOverride() {
        let map = ["FOOD_AND_DRINK": "cat_food"]
        let totals = CategorySpend.totals(
            lines: [line(18.50, "2026-08-12", plaid: "FOOD_AND_DRINK")],
            month: "2026-08",
            plaidPrimaryToCategoryId: map
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
        XCTAssertEqual(totals["__none__"], 100, accuracy: 0.001)
    }

    func testBudgetsAndCategoriesWouldAgree() {
        // Two rows that old BudgetsView (userCategory-only) would split apart.
        let map = ["FOOD_AND_DRINK": "cat_food"]
        let lines = [
            line(30, "2026-08-03", user: "cat_food"),
            line(20, "2026-08-07", plaid: "FOOD_AND_DRINK"),
        ]
        let totals = CategorySpend.totals(lines: lines, month: "2026-08", plaidPrimaryToCategoryId: map)
        XCTAssertEqual(CategorySpend.spent(for: "cat_food", in: totals), 50, accuracy: 0.001)
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
}
