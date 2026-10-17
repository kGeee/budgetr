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
        sortDescriptors: [NSSortDescriptor(key: "sortOrder", ascending: true)],
        predicate: NSPredicate(format: "archived == NO")
    )
    private var categories: FetchedResults<CDCategory>

    @FetchRequest(sortDescriptors: [])
    private var budgets: FetchedResults<CDBudget>

    private struct Row: Identifiable {
        let id: String
        let name: String
        let icon: String?
        let spent: Double
        let budget: Double?
        let count: Int
    }

    private var rows: [Row] {
        let idx = CategoryIndex(categories: Array(categories))
        let styles = CategoryStyles(categories: Array(categories))
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
                    icon: styles.icon(key),
                    spent: value,
                    budget: limits[key].flatMap { $0 > 0 ? $0 : nil },
                    count: counts[key] ?? 0
                )
            }
            .sorted { $0.spent > $1.spent }
    }

    var body: some View {
        let rows = self.rows
        let total = rows.reduce(0) { $0 + $1.spent }

        BScreen("Categories", eyebrow: "This month · \(rows.count) categories") {
            if rows.isEmpty {
                Card {
                    EmptyState(symbol: "tag", title: "Nothing spent this month", message: "Import budgetr.db, or wait for the month to start.")
                }
                .rise(0)
            } else {
                HStack(alignment: .center, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        AnimatedMoney(value: total, font: F.display(40))
                        Text("across \(rows.reduce(0) { $0 + $1.count }) transactions")
                            .font(F.body(12.5))
                            .foregroundStyle(T.faint)
                    }
                    Spacer(minLength: 0)
                    MixDonut(slices: slices(rows), size: 96)
                }
                .rise(0)

                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                            categoryRow(row, tint: T.chart[i % T.chart.count], total: total)
                                .overlay(alignment: .top) { if i > 0 { Hairline() } }
                        }
                    }
                }
                .rise(1)
            }
        }
    }

    private func slices(_ rows: [Row]) -> [MixSlice] {
        rows.enumerated().map { i, r in
            MixSlice(id: r.id, name: r.name, value: r.spent, color: T.chart[i % T.chart.count])
        }
    }

    private func categoryRow(_ row: Row, tint: Color, total: Double) -> some View {
        // Over budget is stated in coral, not implied by a bar that runs off the
        // end — the web app's rule, and the reason you notice it.
        let over = row.budget.map { row.spent > $0 } ?? false

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                GlyphTile(icon: row.icon, color: tint, size: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.name).font(F.medium(14)).foregroundStyle(T.paper).lineLimit(1)
                    Text("\(row.count) transaction\(row.count == 1 ? "" : "s") · \(total > 0 ? Int((row.spent / total * 100).rounded()) : 0)% of spend")
                        .font(F.body(11))
                        .foregroundStyle(T.faint)
                }
                Spacer()
                Text(row.spent.money())
                    .font(F.mono(13))
                    .foregroundStyle(over ? T.coral : T.paper)
            }

            if let budget = row.budget {
                StripedMeter(fraction: row.spent / budget, color: over ? T.coral : tint, height: 8)
                Text(over
                     ? "\((row.spent - budget).money()) over \(budget.money())"
                     : "\((budget - row.spent).money()) left of \(budget.money())")
                    .font(F.mono(10))
                    .foregroundStyle(over ? T.coral : T.faint)
            } else {
                SlimMeter(fraction: total > 0 ? row.spent / total : 0, color: tint.opacity(0.7))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .accessibilityElement(children: .combine)
    }
}
