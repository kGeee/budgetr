import SwiftUI
import CoreData

struct BudgetsView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "sortOrder", ascending: true)])
    private var categories: FetchedResults<CDCategory>

    var body: some View {
        List {
            ForEach(categories, id: \.objectID) { category in
                let budgetAmount = category.budget?.amount ?? 0
                let spentAmount = spent(for: category)
                let pacing = BudgetPacing.current(totalBudget: budgetAmount, spentToDate: spentAmount)
                VStack(alignment: .leading, spacing: 6) {
                    Text(category.name ?? "—").font(.headline)
                    if budgetAmount > 0 {
                        let ratio = min(spentAmount / budgetAmount, 1.0)
                        ProgressView(value: ratio)
                            .tint(pacing.isAheadOfPace ? .orange : .green)
                        HStack {
                            Text("\(spentAmount, format: .currency(code: "USD")) spent")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("of \(budgetAmount, format: .currency(code: "USD"))")
                                .font(.caption)
                                .foregroundStyle(pacing.isAheadOfPace ? Color.orange : Color.secondary)
                        }
                        Text("Projected: \(pacing.projectedMonthEnd, format: .currency(code: "USD"))")
                            .font(.caption2)
                            .foregroundStyle(pacing.isAheadOfPace ? Color.orange : Color.secondary)
                    } else {
                        Text("No budget set")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .navigationTitle("Budgets")
    }

    private func spent(for category: CDCategory) -> Double {
        let calendar = Calendar.current
        let now = Date()
        let year = calendar.component(.year, from: now)
        let month = calendar.component(.month, from: now)
        let prefix = String(format: "%04d-%02d", year, month)

        let req = NSFetchRequest<CDTransaction>(entityName: "CDTransaction")
        // Positive amount = spending (Plaid convention). Filter to this category + current month.
        req.predicate = NSPredicate(
            format: "userCategory == %@ AND amount > 0 AND date BEGINSWITH %@",
            category, prefix
        )
        let txns = (try? context.fetch(req)) ?? []
        return txns.reduce(0) { $0 + $1.amount }
    }
}
