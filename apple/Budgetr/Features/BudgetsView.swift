import SwiftUI
import CoreData

/// Budgets (Phase 2). Mirrors `web/app/budgets/page.tsx`: monthly budgets per
/// category, with the budget-pace projection from `BudgetPacing`.
struct BudgetsView: View {
    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "sortOrder", ascending: true)])
    private var categories: FetchedResults<CDCategory>

    var body: some View {
        List {
            ForEach(categories, id: \.objectID) { category in
            let amount = category.budget?.amount ?? 0
            // Spend wiring lands with the queries port; pace math is ready today.
            let pacing = BudgetPacing.current(totalBudget: amount, spentToDate: 0)
            VStack(alignment: .leading, spacing: 4) {
                Text(category.name ?? "—").font(.headline)
                if amount > 0 {
                    Text("Budget \(amount, format: .currency(code: "USD")) · projected \(pacing.projectedMonthEnd, format: .currency(code: "USD"))")
                        .font(.caption)
                        .foregroundStyle(pacing.isAheadOfPace ? Color.orange : Color.secondary)
                } else {
                    Text("No budget set")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            }
        }
        .navigationTitle("Budgets")
    }
}
