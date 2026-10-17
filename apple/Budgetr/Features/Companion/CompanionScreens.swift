import SwiftUI

// The paired screens — the Expo companion's tabs (mobile/src/app/*), natively
// and read-only. Each renders the Summary the Mac published; the derivations
// are CompanionModel's, ported line for line from spending.ts.

// ── Shared pieces ────────────────────────────────────────────────────

/// Sync state, but only when it's worth saying: errors, stale data and an
/// in-flight refresh. "Synced just now" on every screen is noise.
struct CompanionStatusLine: View {
    @EnvironmentObject private var companion: CompanionStore

    var body: some View {
        if let text {
            HStack(spacing: 7) {
                if companion.refreshing {
                    ProgressView().controlSize(.mini).tint(T.muted)
                } else {
                    Circle().fill(warn ? T.brass : T.jade).frame(width: 6, height: 6)
                }
                Text(text)
                    .font(F.body(12))
                    .foregroundStyle(warn ? T.brass : T.muted)
                    .lineLimit(2)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill((warn ? T.brass : T.panel2).opacity(warn ? 0.1 : 0.8)))
            .overlay(Capsule().strokeBorder(warn ? T.brass.opacity(0.35) : T.line, lineWidth: 0.75))
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    private var warn: Bool { companion.syncError != nil || companion.isStale }

    private var text: String? {
        if let e = companion.syncError { return e }
        if companion.refreshing { return "Syncing…" }
        if companion.isStale { return "Showing data from \(CompanionFormat.ago(companion.lastSyncAt)) — your Mac may be asleep." }
        return nil
    }
}

enum CompanionFormat {
    static func ago(_ date: Date?) -> String {
        guard let date else { return "never" }
        let mins = Int(Date().timeIntervalSince(date) / 60)
        if mins < 1 { return "just now" }
        if mins < 60 { return "\(mins)m ago" }
        if mins < 60 * 48 { return "\(mins / 60)h ago" }
        return "\(mins / 60 / 24)d ago"
    }

    /// `Today` / `Yesterday` / `Oct 3`, in UTC like the Mac's day stamps.
    static func day(_ ts: Int) -> String {
        let cal = CompanionModel.utc
        let d = Date(timeIntervalSince1970: TimeInterval(ts))
        let today = cal.startOfDay(for: Date())
        let diff = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: today).day ?? 0
        if diff <= 0 { return "Today" }
        if diff == 1 { return "Yesterday" }
        let f = DateFormatter()
        f.timeZone = cal.timeZone
        f.dateFormat = "MMM d"
        return f.string(from: d)
    }

    static func date(_ sec: Int) -> Date { Date(timeIntervalSince1970: TimeInterval(sec)) }

    static func stateColor(_ state: String) -> Color {
        switch state {
        case "over": return T.coral
        case "warn": return T.brass
        default: return T.jade
        }
    }
}

/// Waiting for the first summary, or the cache was cleared.
private struct AwaitingSummary: View {
    @EnvironmentObject private var companion: CompanionStore

    var body: some View {
        Card {
            EmptyState(
                symbol: "antenna.radiowaves.left.and.right",
                title: "Waiting for your Mac",
                message: "Paired. budgetr on your Mac publishes a summary each time it syncs — keep it running, then pull to refresh."
            ) {
                PillButton(title: companion.refreshing ? "Checking…" : "Check now", systemImage: "arrow.clockwise") {
                    Task { await companion.refresh(manual: true) }
                }
            }
        }
    }
}

/// A transaction row, read-only.
private struct TxnRow: View {
    let txn: Summary.Txn
    let index: [String: Summary.Category]

    var body: some View {
        HStack(spacing: 12) {
            GlyphTile(icon: index[txn.category]?.icon, color: txn.cents > 0 ? T.jade : T.brass, size: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(txn.merchant)
                    .font(F.medium(14))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Text(CompanionModel.name(txn.category, index))
                    if txn.pending {
                        Text("·")
                        Text("pending").foregroundStyle(T.brass)
                    }
                }
                .font(F.body(11.5))
                .foregroundStyle(T.faint)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            // Summary convention: outflow negative. Inflows are the exception,
            // so they're the ones coloured.
            Text((txn.cents > 0 ? "+" : "") + abs(txn.cents).dollars.money())
                .font(F.mono(13.5))
                .foregroundStyle(txn.cents > 0 ? T.jade : T.paper)
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }
}

// ── Spending ─────────────────────────────────────────────────────────

struct CompanionSpendingView: View {
    @EnvironmentObject private var companion: CompanionStore

    @State private var mode = 0
    @State private var openCategory: CompanionModel.CategorySpend?
    @State private var showingWallet = false
    @State private var showingAll = false

    var body: some View {
        let month = CompanionModel.Month()
        let s = companion.summary

        BScreen("Spending", eyebrow: eyebrow(month), trailing: {
            if let s {
                IconChip(systemName: "wallet.pass", badge: !s.alerts.isEmpty, label: "Net worth and accounts") {
                    showingWallet = true
                }
            }
        }) {
            CompanionStatusLine()
            if let s {
                content(s, month: month)
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
        .sheet(item: $openCategory) { row in
            if let s { CategorySpendSheet(row: row, summary: s, month: month) }
        }
        .sheet(isPresented: $showingWallet) {
            if let s { WalletSheet(summary: s) }
        }
    }

    private func eyebrow(_ month: CompanionModel.Month) -> String {
        var parts = ["\(month.label) · day \(month.dayOfMonth) of \(month.daysInMonth)"]
        if companion.lastSyncAt != nil { parts.append("synced \(CompanionFormat.ago(companion.lastSyncAt))") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func content(_ s: Summary, month: CompanionModel.Month) -> some View {
        let totals = CompanionModel.totals(s.spendByDay ?? [], month: month)
        let rows = CompanionModel.categorySpend(s, month: month)
        let limit = s.budgets.reduce(0) { $0 + $1.limitCents }
        let left = limit - totals.spentCents

        VStack(alignment: .leading, spacing: 6) {
            AnimatedMoney(value: totals.spentCents.dollars, font: F.display(46))
            HStack(spacing: 8) {
                if let delta = totals.deltaPct {
                    Text("\(delta > 0 ? "▲" : "▼") \(Int(abs(delta).rounded()))%")
                        .font(F.monoSemibold(12.5))
                        .foregroundStyle(delta > 0 ? T.coral : T.jade)
                    Text("vs \(totals.priorCents.dollars.moneyCompact()) by this day last month")
                        .font(F.body(12.5)).foregroundStyle(T.faint)
                } else {
                    Text("spent this month").font(F.body(12.5)).foregroundStyle(T.faint)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        .rise(0)

        // The worst alert, stated. A dot on an icon is not how you tell someone
        // a bank connection has been dead for weeks.
        if let first = s.alerts.first {
            Button {
                Haptics.tap()
                showingWallet = true
            } label: {
                HStack(spacing: 9) {
                    Circle().fill(T.coral).frame(width: 6, height: 6)
                    Text(first.text)
                        .font(F.body(12.5))
                        .foregroundStyle(T.paper)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    if s.alerts.count > 1 {
                        Text("+\(s.alerts.count - 1)").font(F.monoSemibold(11)).foregroundStyle(T.coral)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(T.coral.opacity(0.1)))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(T.coral.opacity(0.6), lineWidth: 0.75))
            }
            .buttonStyle(.pressScale)
            .rise(0)
        }

        HStack(spacing: 8) {
            Button {
                Haptics.tap()
                showingWallet = true
            } label: {
                StatTile(label: "Net worth", value: s.netWorth.cents.dollars.moneyCompact(), note: "\(s.accounts.count) accounts")
            }
            .buttonStyle(.pressScale)
            StatTile(
                label: left < 0 ? "Over budget" : "Left to spend",
                value: limit > 0 ? abs(left).dollars.moneyCompact() : "—",
                tint: left < 0 ? T.coral : T.paper,
                note: limit > 0 ? "of \(limit.dollars.moneyCompact())" : "no budgets set"
            )
        }
        .rise(1)

        chartCard(totals: totals, rows: rows, limit: limit, month: month).rise(2)

        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Eyebrow("Categories")
                Spacer()
                if rows.count > 6 {
                    Button {
                        Haptics.tap()
                        withAnimation(M.settle) { showingAll.toggle() }
                    } label: {
                        Text(showingAll ? "Fewer" : "All \(rows.count) ›").font(F.semibold(12)).foregroundStyle(T.brass)
                    }
                    .buttonStyle(.plain)
                }
            }
            if rows.isEmpty {
                Text("No spending categorised this month yet.").font(F.body(12.5)).foregroundStyle(T.faint)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(Array((showingAll ? rows : Array(rows.prefix(6))).enumerated()), id: \.element.id) { i, row in
                        CategorySpendTile(row: row) { openCategory = row }.rise(4 + i)
                    }
                }
            }
        }
        .padding(.top, 4)
        .rise(3)
    }

    private func chartCard(totals: CompanionModel.Totals, rows: [CompanionModel.CategorySpend], limit: Int, month: CompanionModel.Month) -> some View {
        let headings = ["By day", "Cumulative vs pace", "Where it went"]
        return Card(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Eyebrow(headings[mode])
                    Spacer(minLength: 0)
                    Segmented(options: [("Daily", 0), ("Pace", 1), ("Mix", 2)], selection: $mode)
                        .frame(width: 176)
                }
                ZStack {
                    switch mode {
                    case 0:
                        if totals.perDay.contains(where: { $0 > 0 }) {
                            ScrubBars(points: totals.perDay.enumerated().map { i, c in
                                BarPoint(id: "d\(i)", date: CompanionFormat.date(month.startSec + i * 86_400), value: c.dollars)
                            }, height: 100)
                        } else {
                            empty("No spending recorded this month.")
                        }
                    case 1:
                        if totals.cumulative.count > 1 {
                            PaceChart(
                                cumulative: totals.cumulative.map(\.dollars),
                                budget: limit.dollars,
                                daysInMonth: month.daysInMonth,
                                dayOfMonth: month.dayOfMonth,
                                height: 112
                            )
                        } else {
                            empty("Not enough of the month yet to draw a pace.")
                        }
                    default:
                        let slices = mixSlices(rows, total: totals.spentCents)
                        if slices.isEmpty {
                            empty("No categorised spending yet this month.")
                        } else {
                            HStack(spacing: 16) {
                                MixDonut(slices: slices, size: 116)
                                VStack(alignment: .leading, spacing: 5) {
                                    ForEach(slices) { sl in
                                        HStack(spacing: 7) {
                                            RoundedRectangle(cornerRadius: 2).fill(sl.color).frame(width: 8, height: 8)
                                            Text(sl.name).font(F.body(11.5)).foregroundStyle(T.muted).lineLimit(1)
                                            Spacer(minLength: 4)
                                            Text(sl.value.moneyCompact()).font(F.mono(11.5)).foregroundStyle(T.paper)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .frame(height: 128)
                .frame(maxWidth: .infinity)
                .id(mode)
                .transition(.opacity)
            }
        }
    }

    /// The named categories plus whatever the month total exceeds them —
    /// without the remainder the ring would overstate every slice.
    private func mixSlices(_ rows: [CompanionModel.CategorySpend], total: Int) -> [MixSlice] {
        let head = Array(rows.prefix(6))
        var slices = head.enumerated().map { i, r in
            MixSlice(id: r.id, name: r.name, value: r.cents.dollars, color: T.chart[i % T.chart.count])
        }
        let rest = max(0, total - head.reduce(0) { $0 + $1.cents })
        if rest > 0 { slices.append(MixSlice(id: "__rest", name: "Everything else", value: rest.dollars, color: T.muted)) }
        return slices
    }

    private func empty(_ text: String) -> some View {
        Text(text).font(F.body(12)).foregroundStyle(T.faint).multilineTextAlignment(.center)
    }
}

private struct CategorySpendTile: View {
    let row: CompanionModel.CategorySpend
    let action: () -> Void

    private var tint: Color { row.budget.map { CompanionFormat.stateColor($0.state) } ?? T.brass }

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    GlyphIcon(icon: row.icon, color: tint, size: 12.5)
                    Text(row.name).font(F.semibold(11.5)).foregroundStyle(T.muted).lineLimit(1)
                }
                Text(row.cents.dollars.moneyCompact())
                    .font(F.monoSemibold(19))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.top, 6)
                if let b = row.budget, b.limitCents > 0 {
                    SlimMeter(fraction: Double(row.cents) / Double(b.limitCents), color: tint).padding(.top, 9)
                    Text("\(Int((Double(row.cents) / Double(b.limitCents) * 100).rounded()))% of \(b.limitCents.dollars.moneyCompact())")
                        .font(F.body(10))
                        .foregroundStyle(b.state == "over" ? T.coral : T.faint)
                        .padding(.top, 5)
                } else {
                    Text(row.partial ? "recent only · no budget" : "no budget")
                        .font(F.body(10)).foregroundStyle(T.faint).padding(.top, 9)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: T.radiusSmall, style: .continuous)
                    .fill(T.panel.opacity(0.78))
                    .overlay(RoundedRectangle(cornerRadius: T.radiusSmall, style: .continuous).strokeBorder(T.line, lineWidth: 0.75))
            )
            .contentShape(RoundedRectangle(cornerRadius: T.radiusSmall, style: .continuous))
        }
        .buttonStyle(.pressScale)
        .accessibilityElement(children: .combine)
    }
}

/// One category: its month, its budget, its recent transactions.
private struct CategorySpendSheet: View {
    let row: CompanionModel.CategorySpend
    let summary: Summary
    let month: CompanionModel.Month

    var body: some View {
        let index = CompanionModel.categoryIndex(summary)
        let txns = CompanionModel.categoryTxns(summary, category: row.id, month: month)
        let tint = row.budget.map { CompanionFormat.stateColor($0.state) } ?? T.brass
        var daily = [Double](repeating: 0, count: month.dayOfMonth)
        for t in txns {
            let d = CompanionModel.dayOfMonth(t.ts)
            if d >= 1 && d <= daily.count { daily[d - 1] += abs(t.cents).dollars }
        }

        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    GlyphTile(icon: row.icon, color: tint, size: 32)
                    Text(row.name).font(F.display(21)).foregroundStyle(T.paper)
                }
                AnimatedMoney(value: row.cents.dollars, font: F.display(36)).padding(.top, 16)
                Text(row.partial ? "this month · from recent transactions only" : "this month")
                    .font(F.body(12)).foregroundStyle(T.faint).padding(.top, 2)

                if let b = row.budget, b.limitCents > 0 {
                    StripedMeter(fraction: Double(b.spentCents) / Double(b.limitCents), color: tint).padding(.top, 16)
                    Text("\(b.spentCents.dollars.money()) of \(b.limitCents.dollars.money()) · \(b.spentCents > b.limitCents ? "\((b.spentCents - b.limitCents).dollars.money()) over" : "\((b.limitCents - b.spentCents).dollars.money()) left")")
                        .font(F.body(12))
                        .foregroundStyle(b.spentCents > b.limitCents ? T.coral : T.muted)
                        .padding(.top, 10)
                }

                if daily.filter({ $0 > 0 }).count > 1 {
                    Eyebrow("By day").padding(.top, 24)
                    MiniBars(values: daily, height: 44, color: tint).padding(.top, 10)
                }

                Eyebrow("\(txns.count) recent transaction\(txns.count == 1 ? "" : "s")").padding(.top, 24).padding(.bottom, 4)
                ForEach(Array(txns.enumerated()), id: \.element.id) { i, t in
                    TxnRow(txn: t, index: index)
                        .overlay(alignment: .top) { if i > 0 { Hairline() } }
                }
                if txns.isEmpty {
                    Text("Nothing on the recent tape for this month.")
                        .font(F.body(12.5)).foregroundStyle(T.faint).padding(.vertical, 12)
                }
            }
            .padding(22)
        }
        .bSheet()
    }
}

/// Net worth, alerts and accounts — one tap from Spending.
private struct WalletSheet: View {
    let summary: Summary

    var body: some View {
        let assets = summary.accounts.reduce(0) { $0 + max(0, $1.cents) }
        let debts = summary.accounts.reduce(0) { $0 + max(0, -$1.cents) }

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Eyebrow("Net worth")
                AnimatedMoney(value: summary.netWorth.cents.dollars, font: F.display(38)).padding(.top, 8)
                SparkLine(points: summary.netWorth.spark.map {
                    BarPoint(id: "\($0.d)", date: CompanionFormat.date($0.d), value: $0.cents.dollars)
                }, height: 84)
                .padding(.top, 12)
                Text("\(assets.dollars.moneyCompact()) assets · \(debts.dollars.moneyCompact()) debts")
                    .font(F.body(12)).foregroundStyle(T.muted).padding(.top, 6)

                if !summary.alerts.isEmpty {
                    Eyebrow("Alerts").padding(.top, 24).padding(.bottom, 8)
                    VStack(spacing: 8) {
                        ForEach(summary.alerts) { a in
                            HStack(alignment: .top, spacing: 9) {
                                Circle().fill(T.coral).frame(width: 6, height: 6).padding(.top, 6)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(a.text).font(F.body(13)).foregroundStyle(T.paper)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text(CompanionFormat.day(a.ts)).font(F.mono(10)).foregroundStyle(T.faint)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(T.panel2))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(T.lineStrong, lineWidth: 0.75))
                        }
                    }
                    Text("Dismiss alerts on your Mac.").font(F.body(11)).foregroundStyle(T.faint).padding(.top, 6)
                }

                Eyebrow("Accounts").padding(.top, 24).padding(.bottom, 4)
                ForEach(Array(summary.accounts.enumerated()), id: \.element.id) { i, a in
                    HStack(spacing: 12) {
                        Image(systemName: AccountsView.typeSymbol(a.kind))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(a.cents < 0 ? T.coral : T.brass)
                            .frame(width: 26, height: 26)
                            .background(Circle().fill((a.cents < 0 ? T.coral : T.brass).opacity(0.12)))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.name).font(F.medium(14)).foregroundStyle(T.paper).lineLimit(1)
                            Text(AccountsView.typeLabel(a.kind)).font(F.body(11)).foregroundStyle(T.faint)
                        }
                        Spacer()
                        Text(a.cents.dollars.money())
                            .font(F.mono(13.5))
                            .foregroundStyle(a.cents < 0 ? T.coral : T.paper)
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .top) { if i > 0 { Hairline() } }
                }
            }
            .padding(22)
        }
        .bSheet([.large])
    }
}

// ── Activity ─────────────────────────────────────────────────────────

struct CompanionActivityView: View {
    @EnvironmentObject private var companion: CompanionStore
    @State private var window = 30

    var body: some View {
        BScreen("Activity", eyebrow: "Recent transactions") {
            CompanionStatusLine()
            if let s = companion.summary {
                let index = CompanionModel.categoryIndex(s)
                spendCard(s).rise(0)
                ForEach(Array(groups(s).enumerated()), id: \.element.day) { i, g in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Eyebrow(g.day, color: T.muted)
                            Spacer()
                            let out = g.txns.reduce(0) { $0 + max(0, -$1.cents) }
                            if out > 0 { Text(out.dollars.money()).font(F.mono(10.5)).foregroundStyle(T.faint) }
                        }
                        .padding(.horizontal, 4)
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(g.txns.enumerated()), id: \.element.id) { j, t in
                                    TxnRow(txn: t, index: index)
                                        .padding(.horizontal, 14)
                                        .overlay(alignment: .top) { if j > 0 { Hairline().padding(.leading, 60) } }
                                }
                            }
                        }
                    }
                    .rise(1 + i)
                }
                Text("The \(s.recent.count) most recent — the full ledger stays on your Mac.")
                    .font(F.body(11.5))
                    .foregroundStyle(T.faint)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
    }

    private func groups(_ s: Summary) -> [(day: String, txns: [Summary.Txn])] {
        var out: [(String, [Summary.Txn])] = []
        for t in s.recent.sorted(by: { $0.ts > $1.ts }) {
            let key = CompanionFormat.day(t.ts)
            if var last = out.last, last.0 == key {
                last.1.append(t)
                out[out.count - 1] = last
            } else {
                out.append((key, [t]))
            }
        }
        return out.map { (day: $0.0, txns: $0.1) }
    }

    private func spendCard(_ s: Summary) -> some View {
        let cutoff = Int(Date().timeIntervalSince1970) - window * 86_400
        let points = (s.spendByDay ?? []).filter { $0.d >= cutoff }
        let total = points.reduce(0) { $0 + $1.cents }
        return Card(padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Eyebrow("Spending · \(window)d")
                        Text(total.dollars.money())
                            .font(F.monoSemibold(20))
                            .foregroundStyle(T.paper)
                            .contentTransition(.numericText())
                    }
                    Spacer()
                    Segmented(options: [("7D", 7), ("30D", 30), ("90D", 90)], selection: $window)
                        .frame(width: 150)
                }
                if points.isEmpty {
                    Text("No spending in this window.").font(F.body(12)).foregroundStyle(T.faint)
                        .frame(maxWidth: .infinity, minHeight: 88)
                } else {
                    ScrubBars(points: points.map {
                        BarPoint(id: "\($0.d)", date: CompanionFormat.date($0.d), value: $0.cents.dollars)
                    }, height: 64)
                    .id(window)
                }
            }
        }
    }
}

// ── Budgets ──────────────────────────────────────────────────────────

struct CompanionBudgetsView: View {
    @EnvironmentObject private var companion: CompanionStore

    var body: some View {
        let month = CompanionModel.Month()
        let daysLeft = max(0, month.daysInMonth - month.dayOfMonth)

        BScreen("Budgets", eyebrow: "\(month.label) · \(daysLeft) day\(daysLeft == 1 ? "" : "s") left") {
            CompanionStatusLine()
            if let s = companion.summary {
                if s.budgets.isEmpty {
                    Card {
                        EmptyState(symbol: "chart.pie", title: "No budgets yet", message: "Set budgets on your Mac and they'll appear here, paced against the month.")
                    }
                    .rise(0)
                } else {
                    overview(s, daysLeft: daysLeft).rise(0)
                    list(s).rise(1)
                }
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
    }

    private func overview(_ s: Summary, daysLeft: Int) -> some View {
        let spent = s.budgets.reduce(0) { $0 + $1.spentCents }
        let limit = s.budgets.reduce(0) { $0 + $1.limitCents }
        let left = limit - spent
        // The Mac decides each budget's state; the whole reads as its worst.
        let worst = s.budgets.contains(where: { $0.state == "over" }) ? "over"
            : s.budgets.contains(where: { $0.state == "warn" }) ? "warn" : "ok"
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                AnimatedMoney(value: spent.dollars, font: F.display(44))
                Text("of \(limit.dollars.moneyWhole()) budgeted this month").font(F.body(12.5)).foregroundStyle(T.faint)
            }
            StripedMeter(fraction: limit > 0 ? Double(spent) / Double(limit) : 0, color: CompanionFormat.stateColor(worst))
            HStack(spacing: 8) {
                StatTile(label: left < 0 ? "Over by" : "Left", value: abs(left).dollars.moneyCompact(), tint: left < 0 ? T.coral : T.paper)
                StatTile(label: "Per day", value: daysLeft > 0 && left > 0 ? (left.dollars / Double(daysLeft)).moneyCompact() : "—", note: "to stay on budget")
                StatTile(
                    label: "Over",
                    value: "\(s.budgets.filter { $0.state == "over" }.count)",
                    tint: s.budgets.contains(where: { $0.state == "over" }) ? T.coral : T.jade,
                    note: "of \(s.budgets.count) budgets"
                )
            }
        }
    }

    private func list(_ s: Summary) -> some View {
        let index = CompanionModel.categoryIndex(s)
        let rank = ["over": 0, "warn": 1, "ok": 2]
        let ordered = s.budgets.sorted {
            let a = rank[$0.state] ?? 3, b = rank[$1.state] ?? 3
            if a != b { return a < b }
            return Double($0.spentCents) / Double(max(1, $0.limitCents)) > Double($1.spentCents) / Double(max(1, $1.limitCents))
        }
        return TitledCard("By category", trailing: "\(s.budgets.count) budgets") {
            VStack(spacing: 0) {
                ForEach(Array(ordered.enumerated()), id: \.element.category) { i, b in
                    let color = CompanionFormat.stateColor(b.state)
                    VStack(alignment: .leading, spacing: 9) {
                        HStack(spacing: 10) {
                            GlyphTile(icon: index[b.category]?.icon, color: color, size: 28)
                            Text(CompanionModel.name(b.category, index))
                                .font(F.medium(14)).foregroundStyle(T.paper).lineLimit(1)
                            Spacer(minLength: 8)
                            Text(b.spentCents.dollars.moneyWhole())
                                .font(F.mono(13)).foregroundStyle(b.state == "over" ? T.coral : T.paper)
                            + Text(" / \(b.limitCents.dollars.moneyWhole())")
                                .font(F.mono(11)).foregroundStyle(T.faint)
                        }
                        StripedMeter(fraction: b.limitCents > 0 ? Double(b.spentCents) / Double(b.limitCents) : 0, color: color, height: 10)
                        Text(b.spentCents > b.limitCents
                             ? "\((b.spentCents - b.limitCents).dollars.money()) over"
                             : "\((b.limitCents - b.spentCents).dollars.money()) left\(b.state == "warn" ? " · ahead of pace" : "")")
                            .font(F.body(11.5))
                            .foregroundStyle(b.state == "ok" ? T.faint : color)
                    }
                    .padding(.vertical, 12)
                    .overlay(alignment: .top) { if i > 0 { Hairline() } }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.vertical, -12)
        }
    }
}

// ── Holdings ─────────────────────────────────────────────────────────

struct CompanionHoldingsView: View {
    @EnvironmentObject private var companion: CompanionStore

    var body: some View {
        BScreen("Holdings", eyebrow: "Investments") {
            CompanionStatusLine()
            if let s = companion.summary {
                if s.positions.isEmpty && s.investments == nil {
                    Card {
                        EmptyState(symbol: "chart.line.uptrend.xyaxis", title: "No holdings", message: "Investment accounts linked on your Mac show up here.")
                    }
                    .rise(0)
                } else {
                    header(s).rise(0)
                    if let inv = s.investments, !inv.sectors.isEmpty { sectors(inv).rise(1) }
                    positions(s).rise(2)
                    Text("Read-only. Cost basis and lots stay on your Mac.")
                        .font(F.body(11.5)).foregroundStyle(T.faint).frame(maxWidth: .infinity)
                }
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
    }

    private func header(_ s: Summary) -> some View {
        let value = s.investments?.valueCents ?? s.positions.reduce(0) { $0 + $1.cents }
        let spark = s.investments?.spark ?? []
        return VStack(alignment: .leading, spacing: 4) {
            AnimatedMoney(value: value.dollars, font: F.display(44))
            Text("across \(s.positions.count) position\(s.positions.count == 1 ? "" : "s")")
                .font(F.body(12.5)).foregroundStyle(T.faint)
            if spark.count > 1 {
                SparkLine(points: spark.map {
                    BarPoint(id: "\($0.d)", date: CompanionFormat.date($0.d), value: $0.cents.dollars)
                }, height: 90)
                .padding(.top, 8)
            }
        }
    }

    private func sectors(_ inv: Summary.Investments) -> some View {
        let slices = inv.sectors.enumerated().map { i, sec in
            MixSlice(id: sec.sector, name: sec.sector, value: sec.cents.dollars, color: T.chart[i % T.chart.count])
        }
        return TitledCard("Allocation") {
            HStack(spacing: 16) {
                MixDonut(slices: slices, size: 110)
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(slices) { sl in
                        HStack(spacing: 7) {
                            RoundedRectangle(cornerRadius: 2).fill(sl.color).frame(width: 8, height: 8)
                            Text(sl.name).font(F.body(11.5)).foregroundStyle(T.muted).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(inv.valueCents > 0 ? "\(Int((sl.value / inv.valueCents.dollars * 100).rounded()))%" : "—")
                                .font(F.mono(11.5)).foregroundStyle(T.paper)
                        }
                    }
                }
            }
        }
    }

    private func positions(_ s: Summary) -> some View {
        TitledCard("Positions", trailing: "\(s.positions.count)") {
            VStack(spacing: 0) {
                ForEach(Array(s.positions.enumerated()), id: \.element.symbol) { i, p in
                    HStack(spacing: 12) {
                        Text(String(p.symbol.prefix(4)))
                            .font(F.monoSemibold(10.5))
                            .foregroundStyle(T.brass)
                            .frame(width: 44, height: 30)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(T.brass.opacity(0.1)))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.name ?? p.symbol).font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                            Text([p.qtyLabel.map { "\($0) sh" }, p.sector].compactMap { $0 }.joined(separator: " · "))
                                .font(F.body(11)).foregroundStyle(T.faint).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(p.cents.dollars.money()).font(F.mono(13)).foregroundStyle(T.paper)
                            if let bp = p.dayBp {
                                Text("\(bp >= 0 ? "+" : "−")\(String(format: "%.2f", Double(abs(bp)) / 100))%")
                                    .font(F.mono(10.5))
                                    .foregroundStyle(bp >= 0 ? T.jade : T.coral)
                            }
                        }
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .top) { if i > 0 { Hairline() } }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.vertical, -10)
        }
    }
}

// ── More ─────────────────────────────────────────────────────────────

struct CompanionSettingsView: View {
    @EnvironmentObject private var companion: CompanionStore
    @State private var confirmingUnpair = false

    private var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "dev") (\(info?["CFBundleVersion"] as? String ?? "0"))"
    }

    var body: some View {
        BScreen("More", eyebrow: "Companion · \(version)") {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Sync").padding(.leading, 4)
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        row("Last sync", CompanionFormat.ago(companion.lastSyncAt))
                        row("Status", companion.syncError ?? "healthy", tint: companion.syncError == nil ? T.jade : T.brass)
                        if let asOf = companion.summary?.asOf {
                            row("Mac's numbers from", CompanionFormat.ago(Date(timeIntervalSince1970: TimeInterval(asOf))))
                        }
                    }
                }
            }
            .rise(0)

            PillButton(title: companion.refreshing ? "Syncing…" : "Sync now", systemImage: "arrow.clockwise") {
                Task { await companion.refresh(manual: true) }
            }
            .disabled(companion.refreshing)
            .rise(1)

            Text("Your Mac is the source of truth. This phone holds an end-to-end encrypted snapshot — the relay in between can never read it, and edits stay on the Mac.")
                .font(F.body(12))
                .foregroundStyle(T.faint)
                .fixedSize(horizontal: false, vertical: true)
                .rise(2)

            PillButton(title: "Unpair this phone", systemImage: "link.badge.plus", role: .destructive) {
                Haptics.warning()
                confirmingUnpair = true
            }
            .rise(3)
        }
        .confirmationDialog("Unpair this phone?", isPresented: $confirmingUnpair, titleVisibility: .visible) {
            Button("Unpair", role: .destructive) {
                Haptics.error()
                companion.unpair()
            }
        } message: {
            Text("This phone forgets the pairing key and the saved summary. Pair again from your Mac any time.")
        }
    }

    private func row(_ label: String, _ value: String, tint: Color = T.paper) -> some View {
        HStack {
            Text(label).font(F.body(14)).foregroundStyle(T.muted)
            Spacer()
            Text(value).font(F.mono(12.5)).foregroundStyle(tint).lineLimit(1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Hairline().padding(.leading, 14) }
    }
}

/// When the Mac writes a newer summary format than this build reads.
struct CompanionUpdateRequiredView: View {
    @EnvironmentObject private var companion: CompanionStore

    var body: some View {
        BScreen("Update budgetr", eyebrow: "Companion") {
            Card {
                EmptyState(
                    symbol: "arrow.down.app",
                    title: "Your Mac is ahead of this app",
                    message: "budgetr on your Mac now publishes a newer format. Update this app from TestFlight to keep reading it."
                ) {
                    PillButton(title: "Unpair instead", role: .destructive) { companion.unpair() }
                }
            }
        }
    }
}
