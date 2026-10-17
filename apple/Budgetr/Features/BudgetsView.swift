import CoreData
import SwiftUI

/// Budgets — the month's allowance, and whether you're spending it on pace.
///
/// Leads with the whole-month position (spent against the total, and where the
/// current rate lands you), then each budgeted category on the striped meter.
/// Categories you spent in but never budgeted for come last, stated rather than
/// left out, because unbudgeted spend is still spend.
struct BudgetsView: View {
    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)])
    private var transactions: FetchedResults<CDTransaction>

    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "sortOrder", ascending: true)])
    private var categories: FetchedResults<CDCategory>

    @FetchRequest(sortDescriptors: [])
    private var budgets: FetchedResults<CDBudget>

    private struct Line: Identifiable {
        let id: String
        let name: String
        let icon: String?
        let spent: Double
        let limit: Double
        let pacing: BudgetPacing
        var state: BudgetState { BudgetState.of(spent: spent, limit: limit, pacing: pacing) }
    }

    private struct Model {
        var budgeted: [Line] = []
        var unbudgeted: [Line] = []
        var totalLimit = 0.0
        var totalSpent = 0.0
        var dayOfMonth = 1
        var daysInMonth = 30
        var pacing = BudgetPacing(totalBudget: 0, spentToDate: 0, dayOfMonth: 1, daysInMonth: 30)
    }

    private var model: Model {
        let calendar = Calendar.current
        let now = Date()
        let idx = CategoryIndex(categories: Array(categories))
        let styles = CategoryStyles(categories: Array(categories))
        let month = MonthSummary.monthKey(of: now)
        let dom = calendar.component(.day, from: now)
        let dim = calendar.range(of: .day, in: .month, for: now)?.count ?? 30

        // Spend is resolved the way the ledger resolves it — the override, else
        // the category Plaid's guess maps to. Counting overrides alone missed
        // every transaction the bank had already categorised correctly.
        var spent: [String: Double] = [:]
        for t in transactions where (t.date ?? "").hasPrefix(month) && t.amount > 0 {
            spent[idx.resolvedId(for: t) ?? "__none__", default: 0] += t.amount
        }
        let limits = Dictionary(
            budgets.compactMap { b in b.category?.id.map { ($0, b.amount) } },
            uniquingKeysWith: { a, _ in a }
        )

        var m = Model()
        m.dayOfMonth = dom
        m.daysInMonth = dim
        for (id, limit) in limits where limit > 0 {
            let s = spent[id] ?? 0
            m.budgeted.append(Line(
                id: id, name: idx.name(forId: id), icon: styles.icon(id), spent: s, limit: limit,
                pacing: BudgetPacing(totalBudget: limit, spentToDate: s, dayOfMonth: dom, daysInMonth: dim)
            ))
        }
        for (id, s) in spent where (limits[id] ?? 0) <= 0 {
            m.unbudgeted.append(Line(
                id: id, name: id == "__none__" ? "Uncategorised" : idx.name(forId: id), icon: styles.icon(id),
                spent: s, limit: 0,
                pacing: BudgetPacing(totalBudget: 0, spentToDate: s, dayOfMonth: dom, daysInMonth: dim)
            ))
        }
        // Most at risk first: the share of the allowance gone.
        m.budgeted.sort { $0.spent / $0.limit > $1.spent / $1.limit }
        m.unbudgeted.sort { $0.spent > $1.spent }
        m.totalLimit = m.budgeted.reduce(0) { $0 + $1.limit }
        m.totalSpent = m.budgeted.reduce(0) { $0 + $1.spent }
        m.pacing = BudgetPacing(totalBudget: m.totalLimit, spentToDate: m.totalSpent, dayOfMonth: dom, daysInMonth: dim)
        return m
    }

    var body: some View {
        let m = model
        let daysLeft = max(0, m.daysInMonth - m.dayOfMonth)

        BScreen("Budgets", eyebrow: "\(Date().formatted(.dateTime.month(.wide))) · \(daysLeft) day\(daysLeft == 1 ? "" : "s") left") {
            if m.budgeted.isEmpty {
                Card {
                    EmptyState(
                        symbol: "chart.pie",
                        title: "No budgets yet",
                        message: "Budgets are set on the desktop app and arrive with the ledger. Once they're here, this page paces each one against the month."
                    )
                }
                .rise(0)
            } else {
                overview(m, daysLeft: daysLeft).rise(0)
                budgetedCard(m).rise(1)
            }
            if !m.unbudgeted.isEmpty {
                unbudgetedCard(m).rise(2)
            }
        }
    }

    private func overview(_ m: Model, daysLeft: Int) -> some View {
        let state = BudgetState.of(spent: m.totalSpent, limit: m.totalLimit, pacing: m.pacing)
        let left = m.totalLimit - m.totalSpent
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                AnimatedMoney(value: m.totalSpent, font: F.display(44))
                Text("of \(m.totalLimit.moneyWhole()) budgeted this month")
                    .font(F.body(12.5))
                    .foregroundStyle(T.faint)
            }

            StripedMeter(fraction: m.totalLimit > 0 ? m.totalSpent / m.totalLimit : 0, color: state.color)

            HStack(spacing: 8) {
                StatTile(
                    label: left < 0 ? "Over by" : "Left",
                    value: abs(left).moneyCompact(),
                    tint: left < 0 ? T.coral : T.paper
                )
                StatTile(
                    label: "Projected",
                    value: m.pacing.projectedMonthEnd.moneyCompact(),
                    tint: m.pacing.projectedMonthEnd > m.totalLimit ? T.coral : T.jade,
                    note: m.pacing.isAheadOfPace ? "ahead of pace" : "under pace"
                )
                StatTile(
                    label: "Per day",
                    value: daysLeft > 0 && left > 0 ? (left / Double(daysLeft)).moneyCompact() : "—",
                    note: "to stay on budget"
                )
            }
        }
    }

    private func budgetedCard(_ m: Model) -> some View {
        TitledCard("By category", trailing: "\(m.budgeted.count) budgets") {
            VStack(spacing: 0) {
                ForEach(Array(m.budgeted.enumerated()), id: \.element.id) { i, line in
                    budgetRow(line)
                        .padding(.vertical, 12)
                        .overlay(alignment: .top) { if i > 0 { Hairline() } }
                }
            }
            .padding(.vertical, -12)
        }
    }

    private func budgetRow(_ line: Line) -> some View {
        let state = line.state
        let over = line.spent > line.limit
        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 10) {
                GlyphTile(icon: line.icon, color: state.color, size: 28)
                Text(line.name)
                    .font(F.medium(14))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(line.spent.moneyWhole())
                    .font(F.mono(13))
                    .foregroundStyle(over ? T.coral : T.paper)
                + Text(" / \(line.limit.moneyWhole())")
                    .font(F.mono(11))
                    .foregroundStyle(T.faint)
            }
            StripedMeter(fraction: line.spent / line.limit, color: state.color, height: 10)
            Text(footnote(line))
                .font(F.body(11.5))
                .foregroundStyle(state == .ok ? T.faint : state.color)
        }
        .accessibilityElement(children: .combine)
    }

    private func footnote(_ line: Line) -> String {
        if line.spent > line.limit {
            return "\((line.spent - line.limit).money()) over"
        }
        let left = (line.limit - line.spent).money()
        if line.pacing.isAheadOfPace {
            return "\(left) left · on pace for \(line.pacing.projectedMonthEnd.moneyWhole())"
        }
        return "\(left) left · under pace"
    }

    private func unbudgetedCard(_ m: Model) -> some View {
        let total = m.unbudgeted.reduce(0) { $0 + $1.spent }
        return TitledCard("Without a budget", trailing: total.money()) {
            VStack(spacing: 0) {
                ForEach(Array(m.unbudgeted.enumerated()), id: \.element.id) { i, line in
                    HStack(spacing: 10) {
                        GlyphIcon(icon: line.icon, color: T.muted, size: 12)
                            .frame(width: 18)
                        Text(line.name)
                            .font(F.body(13.5))
                            .foregroundStyle(T.paper)
                            .lineLimit(1)
                        Spacer()
                        Text(line.spent.money())
                            .font(F.mono(12.5))
                            .foregroundStyle(T.muted)
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .top) { if i > 0 { Hairline() } }
                }
            }
            .padding(.vertical, -10)
        }
    }
}
