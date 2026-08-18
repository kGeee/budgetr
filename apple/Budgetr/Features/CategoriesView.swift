import CoreData
import SwiftUI

/// Categories, ranked by what you actually spent this month.
///
/// The web app's Categories page sorts by spend rather than alphabetically,
/// because a category list ordered by name is a reference table and one ordered
/// by money is an answer.
struct CategoriesView: View {
    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)])
    private var transactions: FetchedResults<CDTransaction>

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "name", ascending: true)],
        predicate: NSPredicate(format: "archived == NO")
    )
    private var categories: FetchedResults<CDCategory>

    @FetchRequest(sortDescriptors: [])
    private var budgets: FetchedResults<CDBudget>

    private struct Row: Identifiable {
        let id: String
        let name: String
        let spent: Double
        let budget: Double?
        let count: Int
    }

    private var rows: [Row] {
        let idx = CategoryIndex(categories: Array(categories))
        let month = MonthSummary.monthKey(of: Date())
        let limits = Dictionary(
            budgets.compactMap { b -> (String, Double)? in
                guard let id = b.category?.id else { return nil }
                return (id, b.amount)
            },
            uniquingKeysWith: { a, _ in a }
        )

        var spent: [String: Double] = [:]
        var counts: [String: Int] = [:]
        for txn in transactions where (txn.date ?? "").hasPrefix(month) && txn.amount > 0 {
            let key = idx.resolvedId(for: txn) ?? "__none__"
            spent[key, default: 0] += txn.amount
            counts[key, default: 0] += 1
        }

        return spent
            .map { key, value in
                Row(
                    id: key,
                    name: key == "__none__" ? "Uncategorised" : idx.name(forId: key),
                    spent: value,
                    budget: limits[key],
                    count: counts[key] ?? 0
                )
            }
            .sorted { $0.spent > $1.spent }
    }

    private var total: Double { rows.reduce(0) { $0 + $1.spent } }

    var body: some View {
        ScrollView {
            let rows = self.rows
            if rows.isEmpty {
                ContentUnavailableView(
                    "Nothing spent this month",
                    systemImage: "tag",
                    description: Text("Import budgetr.db, or wait for the month to start.")
                )
                .padding(.top, 80)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 5) {
                        Eyebrow("This month · \(rows.count) categories")
                        Text(total.money())
                            .font(F.display(38))
                            .foregroundStyle(T.paper)
                    }

                    Panel(padding: 0) {
                        VStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                                categoryRow(row, tint: T.chart[i % T.chart.count])
                                if i < rows.count - 1 {
                                    Rectangle().fill(T.line).frame(height: 1)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .background(T.ink)
        .navigationTitle("Categories")
    }

    private func categoryRow(_ row: Row, tint: Color) -> some View {
        // Over budget is stated in coral, not implied by a bar that runs off the
        // end — the web app's rule, and the reason you notice it.
        let over = row.budget.map { row.spent > $0 } ?? false

        return VStack(alignment: .leading, spacing: 7) {
            HStack {
                Circle().fill(tint).frame(width: 8, height: 8)
                Text(row.name).font(F.body(13.5)).foregroundStyle(T.paper)
                Text("\(row.count)").font(F.mono(10)).foregroundStyle(T.faint)
                Spacer()
                Text(row.spent.money())
                    .font(F.mono(13))
                    .foregroundStyle(over ? T.coral : T.paper)
            }

            if let budget = row.budget, budget > 0 {
                MeterBar(fraction: row.spent / budget, color: over ? T.coral : tint)
                Text(over
                     ? "\((row.spent - budget).money()) over \(budget.money())"
                     : "\((budget - row.spent).money()) left of \(budget.money())")
                    .font(F.mono(10))
                    .foregroundStyle(over ? T.coral : T.faint)
            } else {
                Text(total > 0 ? "\(Int((row.spent / total * 100).rounded()))% of spend · no budget" : "no budget")
                    .font(F.mono(10))
                    .foregroundStyle(T.faint)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
