import Charts
import CoreData
import SwiftUI

/// The dashboard: where the money went this month, and whether that's a problem.
///
/// Replaces the Phase-2 placeholder that listed what it would one day show. The
/// arithmetic lives in `MonthSummary` so it can be tested against the web app's
/// output; this file only decides what to draw.
struct DashboardView: View {
    @Environment(\.managedObjectContext) private var context

    /// Every transaction. Fetched whole because the summary needs last month
    /// too, and the local store is a few thousand rows — small enough that a
    /// predicate would buy nothing and cost a bug when the month rolls over.
    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)])
    private var transactions: FetchedResults<CDTransaction>

    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "name", ascending: true)])
    private var categories: FetchedResults<CDCategory>

    @FetchRequest(sortDescriptors: [])
    private var accounts: FetchedResults<CDAccount>

    @FetchRequest(sortDescriptors: [])
    private var budgets: FetchedResults<CDBudget>

    private var model: DashboardModel {
        // Resolve through the same rule the ledger uses. Grouping on the raw
        // stored value instead put overridden and un-overridden rows of the same
        // category in different buckets — which reads as several identical
        // "Uncategorised" bars on the chart.
        //
        // Transfers (and Reimbursable, which lives in the transfer group) are
        // dropped here so month spent / "where it went" match the web app.
        let cats = Array(categories)
        let idx = CategoryIndex(categories: cats)
        let groupById = Dictionary(
            cats.compactMap { c -> (String, String)? in
                guard let id = c.id, let group = c.group else { return nil }
                return (id, group)
            },
            uniquingKeysWith: { a, _ in a }
        )
        let spendEntries: [MonthSummary.Entry] = transactions.compactMap { txn in
            let id = idx.resolvedId(for: txn)
            let group = id.flatMap { groupById[$0] }
            guard CategoryMapping.countsTowardSpend(
                resolvedGroup: group,
                plaidPrimary: txn.category
            ) else { return nil }
            return txn.summaryEntry(using: idx)
        }
        return DashboardModel(
            transactions: spendEntries,
            categoryNames: Dictionary(
                cats.map { ($0.id ?? "", $0.name ?? "") },
                uniquingKeysWith: { a, _ in a }
            ),
            // currentBalance is a nullable Double in the model, and that
            // nullability is load-bearing elsewhere ("no cost basis" is not
            // "$0 cost basis"), so it's unwrapped here rather than flattened
            // in the schema. An account with no balance contributes nothing.
            accounts: accounts.map { ($0.type ?? "", $0.currentBalance?.doubleValue ?? 0) },
            budgetTotal: budgets.reduce(0) { $0 + $1.amount }
        )
    }

    var body: some View {
        ScrollView {
            let m = model

            if transactions.isEmpty {
                EmptyStorePrompt(
                    title: "Nothing imported yet",
                    detail: "Import budgetr.db to see this month's spending."
                )
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    Header(model: m)
                    if !m.byDay.isEmpty { DailySpendCard(model: m) }
                    if m.budgetTotal > 0 { PaceCard(model: m) }
                    if !m.byCategory.isEmpty { CategoryCard(model: m) }
                }
                .padding(20)
            }
        }
        .background(T.ink)
        .navigationTitle("Overview")
    }
}

// ── The numbers ──────────────────────────────────────────────────────

/// Everything the dashboard renders, derived once per redraw.
private struct DashboardModel {
    let entries: [MonthSummary.Entry]
    let categoryNames: [String: String]
    let netWorth: Double
    let budgetTotal: Double

    let month: String
    let spent: Double
    let prior: Double
    let byDay: [MonthSummary.DayTotal]
    let byCategory: [MonthSummary.CategoryTotal]
    let pacing: BudgetPacing

    init(
        transactions: [MonthSummary.Entry],
        categoryNames: [String: String],
        accounts: [(String, Double)],
        budgetTotal: Double,
        now: Date = Date(),
        calendar: Calendar = .current
    ) {
        self.entries = transactions
        self.categoryNames = categoryNames
        self.budgetTotal = budgetTotal

        // Liabilities are held as positive balances, the same as the web app,
        // so they have to be subtracted rather than summed.
        self.netWorth = accounts.reduce(0) { total, account in
            let (type, balance) = account
            let isLiability = type == "credit" || type == "loan"
            return total + (isLiability ? -balance : balance)
        }

        let month = MonthSummary.monthKey(of: now, calendar: calendar)
        let thisMonth = MonthSummary.inMonth(transactions, month: month)

        self.month = month
        self.spent = MonthSummary.spent(thisMonth)
        self.prior = MonthSummary.priorMonthToDate(transactions, now: now, calendar: calendar)
        self.byDay = MonthSummary.byDay(thisMonth, calendar: calendar)
        self.byCategory = MonthSummary.byCategory(thisMonth, names: categoryNames)
        self.pacing = BudgetPacing(
            totalBudget: budgetTotal,
            spentToDate: self.spent,
            dayOfMonth: calendar.component(.day, from: now),
            daysInMonth: calendar.range(of: .day, in: .month, for: now)?.count ?? 30
        )
    }

    var deltaPct: Double? { MonthSummary.deltaPct(spent: spent, prior: prior) }

    var monthLabel: String {
        let f = DateFormatter()
        f.dateFormat = "LLLL"
        f.locale = .current
        let parts = month.split(separator: "-")
        guard parts.count == 2, let m = Int(parts[1]),
              let d = Calendar.current.date(from: DateComponents(year: 2000, month: m, day: 1))
        else { return month }
        return f.string(from: d)
    }
}

// ── Pieces ───────────────────────────────────────────────────────────

private struct Header: View {
    let model: DashboardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow("\(model.monthLabel) · spent so far")

            Text(model.spent, format: .currency(code: "USD"))
                .font(F.display(44))
                .foregroundStyle(T.paper)

            HStack(spacing: 10) {
                if let delta = model.deltaPct {
                    // Up is bad here — this is spending, not income.
                    Label(
                        "\(abs(delta), format: .number.precision(.fractionLength(0)))%",
                        systemImage: delta > 0 ? "arrow.up" : "arrow.down"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(delta > 0 ? T.coral : T.jade)

                    Text("vs \(model.prior, format: .currency(code: "USD")) by this day last month")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("no comparable month yet")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 18) {
                Stat(label: "Net worth", value: model.netWorth)
                if model.budgetTotal > 0 {
                    Stat(
                        label: model.pacing.paceDelta > 0 ? "Over pace by" : "Under pace by",
                        value: abs(model.pacing.paceDelta),
                        tint: model.pacing.isAheadOfPace ? T.coral : T.jade
                    )
                }
            }
            .padding(.top, 8)
        }
    }

    private struct Stat: View {
        let label: String
        let value: Double
        var tint: Color = T.paper

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow(label, color: T.muted)
                Text(value.money())
                    .font(F.mono(14))
                    .foregroundStyle(tint)
            }
        }
    }
}

private struct DailySpendCard: View {
    let model: DashboardModel

    var body: some View {
        TitledPanel("By day") {
            Chart(model.byDay) { day in
                BarMark(
                    x: .value("Day", day.date, unit: .day),
                    y: .value("Spent", day.spent)
                )
                .foregroundStyle(T.jade)
                .cornerRadius(2)
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .frame(height: 140)
        }
    }
}

private struct PaceCard: View {
    let model: DashboardModel

    /// Cumulative spend against the even-pace line — the same reading as the
    /// web app's Budgets chart, which is the one that actually predicts a
    /// blown month rather than reporting it afterwards.
    private var cumulative: [(date: Date, spent: Double)] {
        var running = 0.0
        return model.byDay.map { day in
            running += day.spent
            return (day.date, running)
        }
    }

    var body: some View {
        TitledPanel("Cumulative vs pace") {
            Chart {
                ForEach(cumulative, id: \.date) { point in
                    AreaMark(x: .value("Day", point.date), y: .value("Spent", point.spent))
                        .foregroundStyle(T.jade.opacity(0.16))
                    LineMark(x: .value("Day", point.date), y: .value("Spent", point.spent))
                        .foregroundStyle(model.pacing.isAheadOfPace ? T.coral : T.jade)
                }
                RuleMark(y: .value("Budget", model.budgetTotal))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .foregroundStyle(.secondary)
                    .annotation(position: .top, alignment: .leading) {
                        Text("budget \(model.budgetTotal, format: .currency(code: "USD"))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .frame(height: 150)

            Text(
                model.pacing.isAheadOfPace
                    ? "On this pace you'll finish the month at \(model.pacing.projectedMonthEnd, format: .currency(code: "USD"))."
                    : "Tracking under budget — projected \(model.pacing.projectedMonthEnd, format: .currency(code: "USD")) by month end."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

private struct CategoryCard: View {
    let model: DashboardModel

    var body: some View {
        TitledPanel("Where it went") {
            Chart(model.byCategory) { row in
                BarMark(
                    x: .value("Spent", row.spent),
                    y: .value("Category", row.name)
                )
                .foregroundStyle(by: .value("Category", row.name))
                .cornerRadius(3)
            }
            .chartLegend(.hidden)
            .chartXAxis { AxisMarks(position: .bottom) }
            .frame(height: CGFloat(model.byCategory.count) * 30 + 20)
        }
    }
}


// ── Bridging ─────────────────────────────────────────────────────────

private extension CDTransaction {
    /// Core Data row → the pure summary type.
    ///
    /// The category is resolved, not read: the override wins, else the category
    /// whose `plaidPrimary` matches — the web app's `effectiveCatId`. Pending
    /// transactions are kept, because they are money already committed and
    /// dropping them makes today's total look wrong.
    func summaryEntry(using index: CategoryIndex) -> MonthSummary.Entry {
        MonthSummary.Entry(
            amount: amount,
            date: date ?? "",
            categoryId: index.resolvedId(for: self),
            pending: pending
        )
    }
}

#Preview {
    DashboardView()
        .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
}
