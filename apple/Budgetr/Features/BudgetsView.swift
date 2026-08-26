import Charts
import CoreData
import SwiftUI

/// Budgets — one bar per category that has a limit set.
///
/// Only categories with a `CDBudget` row appear here (limits are read-only on
/// native; set them on the web app). Spend is resolved the same way as
/// `CategoriesView`: user override wins, else Plaid-primary → category mapping.
struct BudgetsView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)])
    private var transactions: FetchedResults<CDTransaction>

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "sortOrder", ascending: true)],
        predicate: NSPredicate(format: "archived == NO")
    )
    private var categories: FetchedResults<CDCategory>

    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "amount", ascending: false)])
    private var budgets: FetchedResults<CDBudget>

    private var model: BudgetModel {
        BudgetModel(
            transactions: transactions.map(\.spendLine),
            categories: Array(categories),
            budgets: Array(budgets)
        )
    }

    var body: some View {
        ScrollView {
            let m = model

            if FirstRunImport.storeIsEmpty(context) {
                EmptyStorePrompt(
                    title: "No budgets yet",
                    detail: "Import budgetr.db to load your categories and limits."
                )
            } else if m.rows.isEmpty {
                ContentUnavailableView(
                    "No budgets set",
                    systemImage: "wallet.bifold",
                    description: Text("Add limits on the web app — only categories with a budget appear here.")
                )
                .padding(.top, 80)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    hero(m)
                    ForEach(m.rows) { row in
                        budgetRow(row)
                    }
                }
                .padding(20)
            }
        }
        .background(T.ink)
        .navigationTitle("Budgets")
    }

    // MARK: - Hero

    private func hero(_ m: BudgetModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(m.leftToSpend < 0 ? "Over budget" : "Left to spend", color: m.leftToSpend < 0 ? T.coral : T.brass)
            Text(abs(m.leftToSpend).money())
                .font(F.display(38))
                .foregroundStyle(m.leftToSpend < 0 ? T.coral : T.paper)
            Text("\(m.totalSpent.money()) of \(m.totalLimit.money()) · \(m.monthLabel)")
                .font(F.body(12.5))
                .foregroundStyle(T.muted)

            if m.totalLimit > 0, !m.byDay.isEmpty {
                paceChart(m)
            }

            Text("Projected \(m.pacing.projectedMonthEnd.money()) by month end")
                .font(F.mono(11))
                .foregroundStyle(m.pacing.isAheadOfPace ? T.coral : T.faint)
        }
    }

    private func paceChart(_ m: BudgetModel) -> some View {
        let cumulative = m.cumulativeByDay
        return Chart {
            ForEach(cumulative, id: \.date) { point in
                AreaMark(x: .value("Day", point.date), y: .value("Spent", point.spent))
                    .foregroundStyle((m.pacing.isAheadOfPace ? T.coral : T.jade).opacity(0.14))
                LineMark(x: .value("Day", point.date), y: .value("Spent", point.spent))
                    .foregroundStyle(m.pacing.isAheadOfPace ? T.coral : T.jade)
            }
            RuleMark(y: .value("Budget", m.totalLimit))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .foregroundStyle(T.faint)
        }
        .chartYAxis { AxisMarks(position: .leading) }
        .frame(height: 120)
        .padding(.top, 6)
    }

    // MARK: - Rows

    private func budgetRow(_ row: BudgetModel.Row) -> some View {
        let tint = row.utilisation == .over ? T.coral : row.utilisation == .warn ? T.brass : T.jade

        return Panel {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(row.name)
                        .font(F.medium(14))
                        .foregroundStyle(T.paper)
                    Spacer()
                    Text("\(row.spent.money()) / \(row.limit.money())")
                        .font(F.mono(12.5))
                        .foregroundStyle(tint)
                }

                MeterBar(fraction: row.limit > 0 ? row.spent / row.limit : 0, color: tint)

                if row.utilisation != .ok {
                    Text(row.utilisation == .over ? "Over budget" : "Approaching limit")
                        .font(F.mono(10))
                        .foregroundStyle(tint)
                        .textCase(.uppercase)
                        .tracking(1.2)
                }
            }
        }
    }
}

// MARK: - Model

private struct BudgetModel {
    struct Row: Identifiable {
        let id: String
        let name: String
        let spent: Double
        let limit: Double
        let utilisation: BudgetUtilisation
    }

    let rows: [Row]
    let totalLimit: Double
    let totalSpent: Double
    let leftToSpend: Double
    let pacing: BudgetPacing
    let byDay: [MonthSummary.DayTotal]
    let monthLabel: String

    var cumulativeByDay: [(date: Date, spent: Double)] {
        var running = 0.0
        return byDay.map { day in
            running += day.spent
            return (day.date, running)
        }
    }

    init(
        transactions: [CategorySpend.Line],
        categories: [CDCategory],
        budgets: [CDBudget],
        now: Date = Date(),
        calendar: Calendar = .current
    ) {
        let idx = CategoryIndex(categories: categories)
        let plaidMap = Dictionary(
            categories.compactMap { c -> (String, String)? in
                guard let id = c.id, let primary = c.plaidPrimary, !primary.isEmpty else { return nil }
                return (primary, id)
            },
            uniquingKeysWith: { a, _ in a }
        )

        let month = MonthSummary.monthKey(of: now, calendar: calendar)
        let totals = CategorySpend.totals(
            lines: transactions,
            month: month,
            plaidPrimaryToCategoryId: plaidMap
        )

        // Only categories with a budget row — same rule as the Expo companion.
        let budgetRows = budgets.compactMap { b -> Row? in
            guard let cat = b.category, let id = cat.id, b.amount > 0 else { return nil }
            let spent = CategorySpend.spent(for: id, in: totals)
            return Row(
                id: id,
                name: cat.name ?? idx.name(forId: id),
                spent: spent,
                limit: b.amount,
                utilisation: BudgetUtilisation.classify(spent: spent, limit: b.amount)
            )
        }.sorted { $0.spent > $1.spent }

        self.rows = budgetRows
        self.totalLimit = budgetRows.reduce(0) { $0 + $1.limit }

        let monthEntries = transactions.filter { $0.date.hasPrefix(month) && $0.amount > 0 }
        let allMonthSpent = monthEntries.reduce(0) { $0 + $1.amount }
        self.totalSpent = allMonthSpent
        self.leftToSpend = totalLimit - allMonthSpent

        let day = calendar.component(.day, from: now)
        let days = calendar.range(of: .day, in: .month, for: now)?.count ?? 30
        self.pacing = BudgetPacing(
            totalBudget: totalLimit,
            spentToDate: allMonthSpent,
            dayOfMonth: day,
            daysInMonth: days
        )

        self.byDay = MonthSummary.byDay(
            monthEntries.map {
                MonthSummary.Entry(amount: $0.amount, date: $0.date, categoryId: nil, pending: false)
            },
            calendar: calendar
        )

        let f = DateFormatter()
        f.dateFormat = "LLLL yyyy"
        f.locale = .current
        self.monthLabel = f.string(from: now)
    }
}

// MARK: - Bridging

private extension CDTransaction {
    var spendLine: CategorySpend.Line {
        CategorySpend.Line(
            amount: amount,
            date: date ?? "",
            userCategoryId: userCategory?.id,
            plaidPrimary: category
        )
    }
}
