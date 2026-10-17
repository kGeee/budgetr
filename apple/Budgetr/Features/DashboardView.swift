import CoreData
import SwiftUI

/// Spending — where the money went this month, and whether that's a problem.
///
/// The companion's home screen, natively: the month-to-date hero with a
/// like-for-like delta, three stat wells, one chart card that switches between
/// daily bars, cumulative pace and the category mix, and a grid of categories
/// you tap into. The arithmetic lives in `MonthSummary` so it can be tested
/// against the web app's output; this file only decides what to draw.
struct DashboardView: View {
    @Environment(\.managedObjectContext) private var context
    @EnvironmentObject private var app: AppModel

    /// Every transaction. Fetched whole because the summary needs last month
    /// too, and the local store is a few thousand rows — small enough that a
    /// predicate would buy nothing and cost a bug when the month rolls over.
    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)])
    private var transactions: FetchedResults<CDTransaction>

    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "sortOrder", ascending: true)])
    private var categories: FetchedResults<CDCategory>

    @FetchRequest(sortDescriptors: [])
    private var accounts: FetchedResults<CDAccount>

    @FetchRequest(sortDescriptors: [])
    private var budgets: FetchedResults<CDBudget>

    @State private var mode: ChartMode = .daily
    @State private var openCategory: SpendingModel.CategoryRow?
    @State private var showingAll = false
    @State private var showingAccounts = false

    private static let tileLimit = 6

    var body: some View {
        let m = SpendingModel(
            transactions: Array(transactions),
            categories: Array(categories),
            accounts: Array(accounts),
            budgets: Array(budgets)
        )

        BScreen("Spending", eyebrow: m.eyebrow, trailing: {
            if !transactions.isEmpty {
                IconChip(systemName: "building.columns", label: "Accounts") { showingAccounts = true }
            }
        }) {
            if transactions.isEmpty {
                WelcomeCard().rise(0)
            } else {
                hero(m).rise(0)
                tiles(m).rise(1)
                chartCard(m).rise(2)
                categoryGrid(m).rise(3)
            }
        }
        .sheet(item: $openCategory) { row in
            CategorySheet(row: row)
        }
        .sheet(isPresented: $showingAccounts) {
            NavigationStack { AccountsView() }
                .bSheet([.large])
        }
    }

    // ── Hero ─────────────────────────────────────────────────────────

    private func hero(_ m: SpendingModel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            AnimatedMoney(value: m.spent, font: F.display(46))

            HStack(spacing: 8) {
                if let delta = m.deltaPct {
                    // Up is bad here — this is spending, not income.
                    Text("\(delta > 0 ? "▲" : "▼") \(Int(abs(delta).rounded()))%")
                        .font(F.monoSemibold(12.5))
                        .foregroundStyle(delta > 0 ? T.coral : T.jade)
                    Text("vs \(m.prior.moneyCompact()) by this day last month")
                        .font(F.body(12.5))
                        .foregroundStyle(T.faint)
                } else {
                    Text("spent this month — no comparable month yet")
                        .font(F.body(12.5))
                        .foregroundStyle(T.faint)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        .accessibilityElement(children: .combine)
    }

    // ── Stat wells ───────────────────────────────────────────────────

    private func tiles(_ m: SpendingModel) -> some View {
        let left = m.budgetTotal - m.spent
        return HStack(spacing: 8) {
            Button {
                Haptics.tap()
                showingAccounts = true
            } label: {
                StatTile(
                    label: "Net worth",
                    value: m.netWorth.moneyCompact(),
                    note: "\(m.accountCount) accounts"
                )
            }
            .buttonStyle(.pressScale)

            StatTile(
                label: left < 0 ? "Over budget" : "Left to spend",
                value: m.budgetTotal > 0 ? abs(left).moneyCompact() : "—",
                tint: left < 0 ? T.coral : T.paper,
                note: m.budgetTotal > 0 ? "of \(m.budgetTotal.moneyCompact())" : "no budgets set"
            )

            StatTile(
                label: "To review",
                value: "\(m.unreviewed)",
                tint: m.unreviewed > 0 ? T.brass : T.jade,
                note: m.unreviewed > 0 ? "transactions" : "all clear"
            )
        }
    }

    // ── One chart slot, three readings ───────────────────────────────

    private func chartCard(_ m: SpendingModel) -> some View {
        Card(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Eyebrow(mode.heading)
                    Spacer(minLength: 0)
                    Segmented(options: ChartMode.options, selection: $mode)
                        .frame(width: 176)
                }

                ZStack {
                    switch mode {
                    case .daily:
                        if m.days.contains(where: { $0.value > 0 }) {
                            ScrubBars(points: m.days, height: 100)
                        } else {
                            chartEmpty("No spending recorded this month.")
                        }
                    case .pace:
                        if m.cumulative.count > 1 {
                            PaceChart(
                                cumulative: m.cumulative,
                                budget: m.budgetTotal,
                                daysInMonth: m.daysInMonth,
                                dayOfMonth: m.dayOfMonth,
                                height: 112
                            )
                        } else {
                            chartEmpty("Not enough of the month yet to draw a pace.")
                        }
                    case .mix:
                        if m.mix.isEmpty {
                            chartEmpty("No categorised spending yet this month.")
                        } else {
                            mix(m)
                        }
                    }
                }
                .frame(height: 128)
                .frame(maxWidth: .infinity)
                .id(mode)
                .transition(.opacity)

                if mode == .pace && m.budgetTotal > 0 {
                    Text(m.pacing.isAheadOfPace
                         ? "On this pace you'll finish at \(m.pacing.projectedMonthEnd.moneyWhole()) — \((m.pacing.projectedMonthEnd - m.budgetTotal).moneyCompact()) over."
                         : "Under pace — projected \(m.pacing.projectedMonthEnd.moneyWhole()) of \(m.budgetTotal.moneyWhole()).")
                        .font(F.body(12))
                        .foregroundStyle(m.pacing.isAheadOfPace ? T.coral : T.muted)
                        .transition(.opacity)
                }
            }
        }
    }

    private func mix(_ m: SpendingModel) -> some View {
        HStack(spacing: 16) {
            MixDonut(slices: m.mix, size: 116)
            VStack(alignment: .leading, spacing: 5) {
                ForEach(m.mix) { slice in
                    HStack(spacing: 7) {
                        RoundedRectangle(cornerRadius: 2).fill(slice.color).frame(width: 8, height: 8)
                        Text(slice.name)
                            .font(F.body(11.5))
                            .foregroundStyle(T.muted)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Text(slice.value.moneyCompact())
                            .font(F.mono(11.5))
                            .foregroundStyle(T.paper)
                    }
                }
            }
        }
    }

    private func chartEmpty(_ text: String) -> some View {
        Text(text)
            .font(F.body(12))
            .foregroundStyle(T.faint)
            .multilineTextAlignment(.center)
    }

    // ── Categories ───────────────────────────────────────────────────

    private func categoryGrid(_ m: SpendingModel) -> some View {
        let shown = showingAll ? m.rows : Array(m.rows.prefix(Self.tileLimit))
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Eyebrow("Categories")
                Spacer()
                if m.rows.count > Self.tileLimit {
                    Button {
                        Haptics.tap()
                        withAnimation(M.settle) { showingAll.toggle() }
                    } label: {
                        Text(showingAll ? "Fewer" : "All \(m.rows.count) ›")
                            .font(F.semibold(12))
                            .foregroundStyle(T.brass)
                    }
                    .buttonStyle(.plain)
                }
            }

            if m.rows.isEmpty {
                Text("Nothing spent this month yet.")
                    .font(F.body(12.5))
                    .foregroundStyle(T.faint)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { i, row in
                        CategoryTile(row: row) { openCategory = row }
                            .rise(4 + i)
                    }
                }
            }
        }
        .padding(.top, 4)
    }
}

// ── Chart modes ──────────────────────────────────────────────────────

private enum ChartMode: String, CaseIterable, Hashable {
    case daily, pace, mix

    var label: String {
        switch self {
        case .daily: return "Daily"
        case .pace: return "Pace"
        case .mix: return "Mix"
        }
    }

    var heading: String {
        switch self {
        case .daily: return "By day"
        case .pace: return "Cumulative vs pace"
        case .mix: return "Where it went"
        }
    }

    static var options: [(label: String, value: ChartMode)] {
        allCases.map { (label: $0.label, value: $0) }
    }
}

// ── The numbers ──────────────────────────────────────────────────────

/// Everything the page renders, derived once per redraw.
private struct SpendingModel {
    struct CategoryRow: Identifiable {
        let id: String
        let name: String
        let icon: String?
        let spent: Double
        let limit: Double?
        let state: BudgetState
        let transactions: [CDTransaction]
        /// Spend per day of the month so far, day 1 first, zeros kept.
        let daily: [Double]

        /// Budget state when there is a budget; brass, the neutral accent, when not.
        var tint: Color { limit == nil ? T.brass : state.color }
    }

    let monthLabel: String
    let dayOfMonth: Int
    let daysInMonth: Int
    let spent: Double
    let prior: Double
    let netWorth: Double
    let accountCount: Int
    let budgetTotal: Double
    let pacing: BudgetPacing
    let unreviewed: Int
    let days: [BarPoint]
    let cumulative: [Double]
    let mix: [MixSlice]
    let rows: [CategoryRow]

    var deltaPct: Double? { MonthSummary.deltaPct(spent: spent, prior: prior) }
    var eyebrow: String { "\(monthLabel) · day \(dayOfMonth) of \(daysInMonth)" }

    init(
        transactions: [CDTransaction],
        categories: [CDCategory],
        accounts: [CDAccount],
        budgets: [CDBudget],
        now: Date = Date(),
        calendar: Calendar = .current
    ) {
        // Resolve through the same rule the ledger uses. Grouping on the raw
        // stored value instead puts overridden and un-overridden rows of the
        // same category in different buckets.
        let idx = CategoryIndex(categories: categories)
        let styles = CategoryStyles(categories: categories)

        let entries = transactions.map {
            MonthSummary.Entry(amount: $0.amount, date: $0.date ?? "", categoryId: idx.resolvedId(for: $0), pending: $0.pending)
        }
        let month = MonthSummary.monthKey(of: now, calendar: calendar)
        let thisMonth = MonthSummary.inMonth(entries, month: month)
        let dom = calendar.component(.day, from: now)
        let dim = calendar.range(of: .day, in: .month, for: now)?.count ?? 30

        let spentToDate = MonthSummary.spent(thisMonth)

        self.monthLabel = now.formatted(.dateTime.month(.wide))
        self.dayOfMonth = dom
        self.daysInMonth = dim
        self.spent = spentToDate
        self.prior = MonthSummary.priorMonthToDate(entries, now: now, calendar: calendar)
        self.unreviewed = transactions.reduce(0) { $0 + ($1.reviewed ? 0 : 1) }

        // Liabilities are held as positive balances, the same as the web app,
        // so they are subtracted rather than summed.
        self.netWorth = accounts.reduce(0) { $0 + $1.signedBalance }
        self.accountCount = accounts.count

        let budgetTotal = budgets.reduce(0) { $0 + $1.amount }
        self.budgetTotal = budgetTotal
        self.pacing = BudgetPacing(totalBudget: budgetTotal, spentToDate: spentToDate, dayOfMonth: dom, daysInMonth: dim)

        // Day 1 → today, empty days kept: the rhythm of the month is the signal.
        func dayIndex(_ date: String) -> Int? {
            guard let d = Int(date.suffix(2)), d >= 1, d <= dom else { return nil }
            return d - 1
        }
        var perDay = [Double](repeating: 0, count: dom)
        for e in thisMonth where e.amount > 0 {
            if let i = dayIndex(e.date) { perDay[i] += e.amount }
        }
        let monthStart = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) ?? now
        self.days = perDay.enumerated().map { i, v in
            BarPoint(id: "d\(i)", date: calendar.date(byAdding: .day, value: i, to: monthStart) ?? monthStart, value: v)
        }
        var running = 0.0
        self.cumulative = perDay.map { running += $0; return running }

        // The mix: the six biggest, then one honest "everything else".
        let names = Dictionary(categories.compactMap { c in c.id.map { ($0, c.name ?? $0) } }, uniquingKeysWith: { a, _ in a })
        self.mix = MonthSummary.byCategory(thisMonth, names: names).enumerated().map { i, c in
            MixSlice(
                id: c.id.isEmpty ? "__none__" : c.id,
                name: c.name,
                value: c.spent,
                color: c.id == "__other__" ? T.muted : T.chart[i % T.chart.count]
            )
        }

        // Category rows: every category with spend this month, biggest first.
        let limits = Dictionary(
            budgets.compactMap { b in b.category?.id.map { ($0, b.amount) } },
            uniquingKeysWith: { a, _ in a }
        )
        var grouped: [String: [CDTransaction]] = [:]
        for t in transactions where (t.date ?? "").hasPrefix(month) && t.amount > 0 {
            grouped[idx.resolvedId(for: t) ?? "__none__", default: []].append(t)
        }
        self.rows = grouped.map { id, txns in
            let spent = txns.reduce(0) { $0 + $1.amount }
            let limit = limits[id].flatMap { $0 > 0 ? $0 : nil }
            var daily = [Double](repeating: 0, count: dom)
            for t in txns {
                if let i = dayIndex(t.date ?? "") { daily[i] += t.amount }
            }
            let state = limit.map {
                BudgetState.of(
                    spent: spent,
                    limit: $0,
                    pacing: BudgetPacing(totalBudget: $0, spentToDate: spent, dayOfMonth: dom, daysInMonth: dim)
                )
            } ?? .ok
            return CategoryRow(
                id: id,
                name: id == "__none__" ? "Uncategorised" : idx.name(forId: id),
                icon: styles.icon(id),
                spent: spent,
                limit: limit,
                state: state,
                transactions: txns,
                daily: daily
            )
        }
        .sorted { $0.spent > $1.spent }
    }
}

// ── Pieces ───────────────────────────────────────────────────────────

/// One category on the grid: its mark, what's gone, and how much of the
/// allowance that is.
private struct CategoryTile: View {
    let row: SpendingModel.CategoryRow
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    GlyphIcon(icon: row.icon, color: row.tint, size: 12.5)
                    Text(row.name)
                        .font(F.semibold(11.5))
                        .foregroundStyle(T.muted)
                        .lineLimit(1)
                }
                Text(row.spent.moneyCompact())
                    .font(F.monoSemibold(19))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.top, 6)

                if let limit = row.limit {
                    SlimMeter(fraction: row.spent / limit, color: row.tint)
                        .padding(.top, 9)
                    Text("\(Int((row.spent / limit * 100).rounded()))% of \(limit.moneyCompact())")
                        .font(F.body(10))
                        .foregroundStyle(row.state == .over ? T.coral : T.faint)
                        .padding(.top, 5)
                } else {
                    Text("\(row.transactions.count) txns · no budget")
                        .font(F.body(10))
                        .foregroundStyle(T.faint)
                        .padding(.top, 9)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: T.radiusSmall, style: .continuous)
                    .fill(T.panel.opacity(0.78))
                    .overlay(
                        RoundedRectangle(cornerRadius: T.radiusSmall, style: .continuous)
                            .strokeBorder(T.line, lineWidth: 0.75)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: T.radiusSmall, style: .continuous))
        }
        .buttonStyle(.pressScale)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows this month's transactions")
    }
}

/// One category: its month, its budget, its transactions.
private struct CategorySheet: View {
    let row: SpendingModel.CategoryRow

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    GlyphTile(icon: row.icon, color: row.tint, size: 32)
                    Text(row.name)
                        .font(F.display(21))
                        .foregroundStyle(T.paper)
                }

                AnimatedMoney(value: row.spent, font: F.display(36))
                    .padding(.top, 16)
                Text("this month · \(row.transactions.count) transaction\(row.transactions.count == 1 ? "" : "s")")
                    .font(F.body(12))
                    .foregroundStyle(T.faint)
                    .padding(.top, 2)

                if let limit = row.limit {
                    StripedMeter(fraction: row.spent / limit, color: row.tint)
                        .padding(.top, 16)
                    Text("\(row.spent.money()) of \(limit.money()) · \(row.spent > limit ? "\((row.spent - limit).money()) over" : "\((limit - row.spent).money()) left")")
                        .font(F.body(12))
                        .foregroundStyle(row.spent > limit ? T.coral : T.muted)
                        .padding(.top, 10)
                }

                if row.daily.filter({ $0 > 0 }).count > 1 {
                    Eyebrow("By day").padding(.top, 24)
                    MiniBars(values: row.daily, height: 44, color: row.tint)
                        .padding(.top, 10)
                }

                Eyebrow("Transactions").padding(.top, 24).padding(.bottom, 4)
                ForEach(Array(row.transactions.enumerated()), id: \.element.objectID) { i, txn in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(txn.merchantName ?? txn.name ?? "—")
                                .font(F.medium(14.5))
                                .foregroundStyle(T.paper)
                                .lineLimit(1)
                            Text(TransactionsView.dayLabel(txn.date ?? "") + (txn.pending ? " · pending" : ""))
                                .font(F.body(11.5))
                                .foregroundStyle(T.faint)
                        }
                        Spacer(minLength: 8)
                        Text(txn.amount.money(txn.isoCurrencyCode ?? "USD"))
                            .font(F.mono(13.5))
                            .foregroundStyle(T.paper)
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .top) { if i > 0 { Hairline() } }
                }
            }
            .padding(22)
        }
        .bSheet()
    }
}

/// The empty store, said warmly: what the app is, and the two ways in.
private struct WelcomeCard: View {
    @Environment(\.managedObjectContext) private var context
    @EnvironmentObject private var app: AppModel

    var body: some View {
        Card(padding: 22) {
            VStack(alignment: .leading, spacing: 16) {
                BrandMark(size: 46, showsWordmark: false)

                Text("Your ledger, in your pocket.")
                    .font(F.display(27))
                    .foregroundStyle(T.paper)
                    .fixedSize(horizontal: false, vertical: true)

                Text("budgetr reads the same ledger as your Mac. Bring it over once — AirDrop budgetr.db, or drop it into Files → On My iPhone → Budgetr — and every screen fills in.")
                    .font(F.body(14))
                    .foregroundStyle(T.muted)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 10) {
                    feature("chart.line.uptrend.xyaxis", "Pace the month", "See whether you'll finish under budget, not after.")
                    feature("checkmark.circle", "Clear the queue", "File each transaction in one tap.")
                    feature("chart.pie", "See where it went", "Categories ranked by what you actually spent.")
                }
                .padding(.vertical, 4)

                PillButton(title: "Import budgetr.db", systemImage: "square.and.arrow.down", role: .primary) {
                    Haptics.tap()
                    app.showingImporter = true
                }
                PillButton(title: "Explore with sample data", systemImage: "sparkles") {
                    app.loadSample(context: context)
                }
                Text("Sample data is clearly marked, and removed in one tap.")
                    .font(F.body(11.5))
                    .foregroundStyle(T.faint)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func feature(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(T.jade)
                .frame(width: 28, height: 28)
                .background(Circle().fill(T.jade.opacity(0.12)))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(F.semibold(13.5)).foregroundStyle(T.paper)
                Text(detail).font(F.body(12)).foregroundStyle(T.faint)
            }
        }
    }
}

#Preview {
    NavigationStack {
        DashboardView()
    }
    .environmentObject(AppModel())
    .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
}
