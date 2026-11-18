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
                    PulseDot(color: warn ? T.brass : T.jade, size: 6)
                        .frame(width: 8, height: 8)
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

    /// `Fri, Oct 17` — the quieter half of a day header.
    static func weekday(_ ts: Int) -> String {
        let f = DateFormatter()
        f.timeZone = CompanionModel.utc.timeZone
        f.dateFormat = "EEE, MMM d"
        return f.string(from: Date(timeIntervalSince1970: TimeInterval(ts)))
    }

    /// `2:14 PM`, local — when on the day it happened.
    static func time(_ ts: Int) -> String {
        Date(timeIntervalSince1970: TimeInterval(ts)).formatted(.dateTime.hour().minute())
    }

    static func date(_ sec: Int) -> Date { Date(timeIntervalSince1970: TimeInterval(sec)) }

    static func stateColor(_ state: String) -> Color {
        switch state {
        case "over": return T.coral
        case "warn": return T.brass
        default: return T.jade
        }
    }

    /// Spent against limit, read against how much of the month has gone.
    static func paceColor(spent: Int, limit: Int, elapsed: Double) -> Color {
        guard limit > 0 else { return T.brass }
        let used = Double(spent) / Double(limit)
        if used > 1 { return T.coral }
        if used > elapsed * 1.05 { return T.brass }
        return T.jade
    }

    /// `BTC-USD` → `BTC`: a crypto pair's quote currency is noise in a tile.
    static func ticker(_ symbol: String) -> String {
        let base = symbol.hasSuffix("-USD") ? String(symbol.dropLast(4)) : symbol
        return String(base.prefix(5))
    }

    static func percent(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }
}

/// Waiting for the first summary, or the cache was cleared.
private struct AwaitingSummary: View {
    @EnvironmentObject private var companion: CompanionStore

    var body: some View {
        VStack(spacing: 16) {
            Card {
                VStack(spacing: 14) {
                    RadarGlyph()
                    Text("Waiting for your Mac")
                        .font(F.display(22))
                        .foregroundStyle(T.paper)
                    Text("Paired. budgetr on your Mac publishes a summary each time it syncs — keep it running, then pull to refresh.")
                        .font(F.body(14))
                        .foregroundStyle(T.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    PillButton(title: companion.refreshing ? "Checking…" : "Check now", systemImage: "arrow.clockwise") {
                        Task { await companion.refresh(manual: true) }
                    }
                    .padding(.top, 4)
                }
                .padding(.vertical, 18)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity)
            }
            // What's coming, as shapes — so the wait reads as loading, not empty.
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 8) {
                        SkeletonBlock(width: 50, height: 8)
                        SkeletonBlock(width: 70, height: 16)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(T.panel.opacity(0.85)))
                }
            }
            .shimmer()
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    SkeletonBlock(width: 90, height: 9)
                    HStack(alignment: .bottom, spacing: 5) {
                        ForEach(0..<18, id: \.self) { i in
                            SkeletonBlock(height: CGFloat(18 + (i * 37 % 60)), radius: 2)
                        }
                    }
                }
            }
            .shimmer()
        }
    }
}

/// Concentric rings breathing out from an antenna — listening for the Mac.
private struct RadarGlyph: View {
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .strokeBorder(T.brass.opacity(0.5), lineWidth: 1)
                    .frame(width: 64, height: 64)
                    .scaleEffect(on ? 1.9 : 1)
                    .opacity(on ? 0 : 0.7)
                    .animation(
                        reduceMotion ? nil : .easeOut(duration: 2.4).repeatForever(autoreverses: false).delay(Double(i) * 0.8),
                        value: on
                    )
            }
            Circle().fill(T.panel2).frame(width: 64, height: 64)
            Circle().strokeBorder(T.brassDim.opacity(0.6), lineWidth: 0.75).frame(width: 64, height: 64)
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(T.brass)
        }
        .frame(height: 110)
        .onAppear { on = true }
        .accessibilityHidden(true)
    }
}

/// A transaction row, read-only.
private struct TxnRow: View {
    let txn: Summary.Txn
    let index: [String: Summary.Category]
    var showsTime = true

    var body: some View {
        let flow = CompanionModel.flow(txn, index)
        // Only real income is coloured as money arriving; a card payment's
        // credit side or a transfer in is money moving, not money earned.
        let inflow = txn.cents > 0 && flow == .income
        let transfer = flow == .transfer
        HStack(spacing: 12) {
            MerchantAvatar(name: txn.merchant, icon: index[txn.category]?.icon, size: 38, inflow: inflow)
            VStack(alignment: .leading, spacing: 3) {
                Text(txn.merchant)
                    .font(F.medium(14))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    if transfer {
                        Image(systemName: "arrow.left.arrow.right").font(.system(size: 9, weight: .semibold))
                    }
                    Text(CompanionModel.name(txn.category, index))
                    if showsTime {
                        Text("·")
                        Text(CompanionFormat.time(txn.ts))
                    }
                }
                .font(F.body(11.5))
                .foregroundStyle(T.muted)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                // Summary convention: outflow negative. Inflows are the
                // exception, so they're the ones coloured.
                Text((txn.cents > 0 ? "+" : "") + abs(txn.cents).dollars.money())
                    .font(F.mono(13.5))
                    .foregroundStyle(inflow ? T.jade : transfer ? T.muted : T.paper)
                if txn.pending {
                    Text("PENDING")
                        .font(F.semibold(8.5))
                        .tracking(0.8)
                        .foregroundStyle(T.brass)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1.5)
                        .background(Capsule().strokeBorder(T.brass.opacity(0.45), style: StrokeStyle(lineWidth: 0.75, dash: [2, 2])))
                }
            }
        }
        .padding(.vertical, 10)
        .opacity(txn.pending ? 0.85 : 1)
        .accessibilityElement(children: .combine)
    }
}

// ── Statement pieces ─────────────────────────────────────────────────
// Local to the companion screens: the rows and small derivations the four
// statements share. Layout only — every figure is the Summary's.

/// The word a fixed budget wears instead of a pace: whether the bill has gone
/// out. Same thresholds as `budgetStatus` in web/lib/budget-verdict.ts.
private enum FixedStatus {
    static func word(_ b: Summary.Budget) -> String {
        if b.spentCents > b.limitCents { return "over" }
        if b.spentCents <= 0 { return "not yet paid" }
        return Double(b.spentCents) >= Double(b.limitCents) * 0.8 ? "paid" : "part paid"
    }
}

/// Today's move across the positions the Mac priced, backed out of their basis
/// points — the same arithmetic PositionDetailView uses for one holding.
private enum PortfolioDay {
    struct Move {
        let cents: Int
        let pct: Double
        /// Positions that carried a day move, of all positions.
        let priced: Int
    }

    static func move(_ s: Summary) -> Move? {
        var now = 0.0, before = 0.0, priced = 0
        for p in s.positions {
            guard let bp = p.dayBp else { continue }
            let r = Double(bp) / 10_000
            guard 1 + r > 0 else { continue }
            now += Double(p.cents)
            before += Double(p.cents) / (1 + r)
            priced += 1
        }
        guard before > 0 else { return nil }
        return Move(cents: Int((now - before).rounded()), pct: (now - before) / before * 100, priced: priced)
    }

    static func percent(_ v: Double) -> String {
        "\(v >= 0 ? "+" : "−")\(String(format: "%.2f", abs(v)))%"
    }
}

/// A category keeps one dot colour across the companion: spending categories
/// take the chart palette in the Mac's order, income is jade, transfers quiet.
private func categoryDotColors(_ s: Summary) -> [String: Color] {
    var out: [String: Color] = [:]
    var i = 0
    for c in s.categories ?? [] where out[c.id] == nil {
        switch c.group {
        case "income": out[c.id] = T.jade
        case "transfer": out[c.id] = T.muted
        default:
            out[c.id] = T.chart[i % (T.chart.count - 1)]
            i += 1
        }
    }
    return out
}

private func budgetOrder(_ budgets: [Summary.Budget]) -> [Summary.Budget] {
    let rank = ["over": 0, "warn": 1, "ok": 2]
    return budgets.sorted {
        let a = rank[$0.state] ?? 3, b = rank[$1.state] ?? 3
        if a != b { return a < b }
        return Double($0.spentCents) / Double(max(1, $0.limitCents)) > Double($1.spentCents) / Double(max(1, $1.limitCents))
    }
}

/// A budget as the category sheet wants it — the Mac's own month total.
private func spendRow(_ b: Summary.Budget, _ index: [String: Summary.Category]) -> CompanionModel.CategorySpend {
    CompanionModel.CategorySpend(
        id: b.category, name: CompanionModel.name(b.category, index), icon: index[b.category]?.icon,
        cents: b.spentCents, budget: b, partial: false
    )
}

private extension View {
    /// Equal-width tap targets laid over a `StatCells` strip, one per cell; nil
    /// leaves that cell inert. (StatCells itself has no actions.)
    func cellTaps(_ taps: [(label: String, run: () -> Void)?]) -> some View {
        overlay {
            HStack(spacing: 0) {
                ForEach(taps.indices, id: \.self) { i in
                    if let tap = taps[i] {
                        Button {
                            Haptics.tap()
                            tap.run()
                        } label: {
                            Color.clear.contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(tap.label)
                    } else {
                        Color.clear.allowsHitTesting(false).accessibilityHidden(true)
                    }
                }
            }
        }
    }
}

/// One budget: name, a figure, and a bar. A flexible budget's bar carries the
/// today tick; a fixed one is brass, says whether it's paid, and has no pace.
private struct BudgetLine: View {
    enum Figure { case left, spentOfLimit }

    let budget: Summary.Budget
    let name: String
    /// Share of the month gone, 0–1.
    let elapsed: Double
    var figure: Figure = .spentOfLimit
    let action: () -> Void

    private var over: Bool { budget.spentCents > budget.limitCents }
    private var used: Double { budget.limitCents > 0 ? Double(budget.spentCents) / Double(budget.limitCents) : 0 }
    private var color: Color {
        if budget.isFixed { return over ? T.coral : T.brass }
        return CompanionFormat.stateColor(budget.state)
    }

    private var word: String? {
        if budget.isFixed { return FixedStatus.word(budget) }
        switch budget.state {
        case "over": return "over"
        case "warn": return "ahead of pace"
        default: return nil
        }
    }

    private var leftText: String {
        over ? "\((budget.spentCents - budget.limitCents).dollars.money()) over"
             : "\((budget.limitCents - budget.spentCents).dollars.money()) left"
    }

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            RuledRow {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(name).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                        if let word {
                            Text(word)
                                .font(F.body(12))
                                .foregroundStyle(over ? T.coral : word == "not yet paid" ? T.muted : T.brass)
                                .lineLimit(1)
                                .layoutPriority(1)
                        }
                        Spacer(minLength: 6)
                        figureText.font(F.mono(13)).lineLimit(1).layoutPriority(2)
                    }
                    TickBar(fraction: used, color: color, tick: budget.isFixed ? nil : elapsed)
                }
                .padding(.vertical, 9)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name), \(budget.spentCents.dollars.money()) of \(budget.limitCents.dollars.money()), \(leftText)\(word.map { ", \($0)" } ?? "")")
        .accessibilityHint("Opens this month's transactions")
    }

    private var figureText: Text {
        switch figure {
        case .left:
            if over { return Text(leftText).foregroundStyle(T.coral) }
            return Text((budget.limitCents - budget.spentCents).dollars.money()).foregroundStyle(T.paper)
                + Text(" left").foregroundStyle(T.muted)
        case .spentOfLimit:
            return Text(budget.spentCents.dollars.money()).foregroundStyle(over ? T.coral : T.paper)
                + Text(" / \(budget.limitCents.dollars.moneyWhole())").foregroundStyle(T.muted)
        }
    }
}

/// A label on the left, a mono figure on the right, an optional quiet note.
private struct FigureRow<Note: View>: View {
    let label: String
    let value: String
    @ViewBuilder var note: Note

    var body: some View {
        RuledRow {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(label).font(F.medium(15)).foregroundStyle(T.paper)
                    note
                }
                Spacer(minLength: 8)
                Text(value).font(F.mono(14)).foregroundStyle(T.paper).contentTransition(.numericText())
            }
            .padding(.vertical, 8)
        }
        .accessibilityElement(children: .combine)
    }
}

// ── Today ────────────────────────────────────────────────────────────

struct CompanionSpendingView: View {
    @EnvironmentObject private var companion: CompanionStore
    @EnvironmentObject private var live: LiveQuotes

    @State private var mode = 0
    @State private var openCategory: CompanionModel.CategorySpend?
    @State private var showingWallet = false
    @State private var showingAll = false
    @State private var showingAllBudgets = false

    var body: some View {
        let month = CompanionModel.Month()
        // The synced summary with live quotes folded into the portfolio — net
        // worth and the portfolio cell move with the market between syncs.
        let book = companion.summary.map { live.book(for: $0) }
        let s = book?.summary

        BScreen("Today", eyebrow: Date().pageEyebrow, trailing: {
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
        .refreshable {
            await companion.refresh(manual: true)
            await live.refresh(for: companion.summary, force: true)
        }
        .task { await live.follow { companion.summary } }
        .sheet(item: $openCategory) { row in
            if let s { CategorySpendSheet(row: row, summary: s, month: month) }
        }
        .sheet(isPresented: $showingWallet) {
            if let s { WalletSheet(summary: s) }
        }
    }

    @ViewBuilder
    private func content(_ s: Summary, month: CompanionModel.Month) -> some View {
        let totals = CompanionModel.totals(s.spendByDay ?? [], month: month)
        let rows = CompanionModel.categorySpend(s, month: month)
        let pos = CompanionModel.budgetPosition(s)
        let index = CompanionModel.categoryIndex(s)
        let elapsed = Double(month.dayOfMonth) / Double(max(1, month.daysInMonth))

        hero(s, pos: pos, totals: totals, month: month, elapsed: elapsed).rise(0)

        // The worst alert, stated. A dot on an icon is not how you tell someone
        // a bank connection has been dead for weeks.
        if let first = s.alerts.first {
            Button {
                Haptics.tap()
                showingWallet = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(T.coral)
                    Text(first.text)
                        .font(F.body(14))
                        .foregroundStyle(T.paper)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 6)
                    if s.alerts.count > 1 {
                        Text("+\(s.alerts.count - 1)").font(F.mono(12)).foregroundStyle(T.coral)
                    }
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(T.muted)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens net worth and accounts")
            .rise(0)
        }

        StatCells(cells: moneyCells(s, totals: totals, month: month))
            .cellTaps([("Open net worth and accounts", { showingWallet = true }), nil])
            .rise(1)

        needsYou(s)

        if !s.budgets.isEmpty {
            let ordered = budgetOrder(s.budgets.filter { !$0.isFixed }) + budgetOrder(s.budgets.filter(\.isFixed))
            StatementSection(
                title: "Budgets",
                action: ordered.count > 3
                    ? (showingAllBudgets ? "Fewer" : "All \(ordered.count)", { withAnimation(M.settle) { showingAllBudgets.toggle() } })
                    : nil
            ) {
                ForEach(showingAllBudgets ? ordered : Array(ordered.prefix(3)), id: \.category) { b in
                    BudgetLine(budget: b, name: CompanionModel.name(b.category, index), elapsed: elapsed, figure: .left) {
                        openCategory = spendRow(b, index)
                    }
                }
            }
            .rise(2)
        }

        monthSection(s, totals: totals, rows: rows, pos: pos, month: month).rise(3)

        TopMerchants(summary: s, month: month).rise(4)

        StatementSection(
            title: "Categories",
            count: rows.count,
            action: rows.count > 6 ? (showingAll ? "Fewer" : "All \(rows.count)", { withAnimation(M.settle) { showingAll.toggle() } }) : nil
        ) {
            if rows.isEmpty {
                Text("No spending categorised this month yet.")
                    .font(F.body(13)).foregroundStyle(T.muted).padding(.vertical, 14)
            } else {
                // Budgeted spend and the tape don't always sum to the daily
                // series, so shares are of whichever is larger — never over 100%.
                let whole = max(totals.spentCents, rows.reduce(0) { $0 + $1.cents }, 1)
                ForEach(showingAll ? rows : Array(rows.prefix(6))) { row in
                    CategoryLine(row: row, share: Double(row.cents) / Double(whole)) {
                        openCategory = row
                    }
                }
            }
        }
        .rise(5)

        Text(footnote(month))
            .font(F.mono(11))
            .foregroundStyle(T.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func footnote(_ month: CompanionModel.Month) -> String {
        var parts = ["\(month.label) · day \(month.dayOfMonth) of \(month.daysInMonth)"]
        if companion.lastSyncAt != nil { parts.append("synced \(CompanionFormat.ago(companion.lastSyncAt))") }
        return parts.joined(separator: " · ")
    }

    // ── Hero ──

    /// Left to spend, the Mac's pace sentence, and the flexible bar with a tick
    /// for today. With no budgets there is nothing to be left of, so the month's
    /// spend stands in.
    @ViewBuilder
    private func hero(_ s: Summary, pos: CompanionModel.BudgetPosition, totals: CompanionModel.Totals, month: CompanionModel.Month, elapsed: Double) -> some View {
        let daysLeft = max(0, month.daysInMonth - month.dayOfMonth)
        if let verdict = CompanionModel.paceVerdict(pos, dayOfMonth: month.dayOfMonth, daysInMonth: month.daysInMonth) {
            let over = pos.left < 0
            let spent = pos.paceSpent.dollars.money()
            let limit = pos.paceLimit.dollars.moneyWhole()
            StatementHero(
                eyebrow: over ? "Over budget" : "Left to spend",
                cents: abs(pos.left),
                color: over ? T.coral : T.paper,
                size: 56
            ) {
                VerdictText(verdict.text + Text(fixedSentence(s, pos)))
            } footer: {
                VStack(spacing: 8) {
                    TickBar(
                        fraction: pos.paceLimit > 0 ? Double(pos.paceSpent) / Double(pos.paceLimit) : 0,
                        color: verdict.tone.color,
                        tick: elapsed,
                        height: 6
                    )
                    HStack {
                        Text("\(spent) of \(limit)")
                        Spacer(minLength: 8)
                        Text("\(daysLeft) day\(daysLeft == 1 ? "" : "s") left")
                    }
                    .font(F.mono(12))
                    .foregroundStyle(T.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                }
                .padding(.top, 4)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(spent) of \(limit) \(pos.judgesFlexible ? "flexible " : "")budget spent, today is day \(month.dayOfMonth) of \(month.daysInMonth)")
            }
        } else {
            StatementHero(eyebrow: "Spent this month", cents: totals.spentCents, size: 56) {
                VerdictText(comparison(totals, month: month) + Text(" No budgets set — add them on your Mac."))
            }
        }
    }

    /// " Rent is paid." — what the fixed budgets are doing while pace is judged
    /// on the rest. Empty unless the month is split.
    private func fixedSentence(_ s: Summary, _ pos: CompanionModel.BudgetPosition) -> String {
        guard pos.judgesFlexible else { return "" }
        let fixed = s.budgets.filter(\.isFixed)
        if fixed.count == 1, let b = fixed.first {
            return " \(CompanionModel.name(b.category, CompanionModel.categoryIndex(s))) is \(FixedStatus.word(b))."
        }
        let paid = fixed.filter { FixedStatus.word($0) == "paid" }.count
        return " \(paid) of \(fixed.count) fixed costs \(paid == 1 ? "is" : "are") paid."
    }

    private func comparison(_ totals: CompanionModel.Totals, month: CompanionModel.Month) -> Text {
        guard let delta = totals.deltaPct else { return Text("No prior month to compare yet.") }
        let pct = "\(Int(abs(delta).rounded()))%"
        return Text(delta > 0 ? "Up " : "Down ")
            + Text(pct).foregroundStyle(delta > 0 ? T.coral : T.jade)
            + Text(" on the \(totals.priorCents.dollars.moneyCompact()) spent by day \(month.dayOfMonth) last month.")
    }

    // ── Money strip ──

    private func moneyCells(_ s: Summary, totals: CompanionModel.Totals, month: CompanionModel.Month) -> [StatCells.Cell] {
        var netNote = "\(s.accounts.count) account\(s.accounts.count == 1 ? "" : "s")"
        var netColor = T.muted
        let spark = s.netWorth.spark
        if let a = spark.first, let b = spark.last, spark.count > 1, a.cents != 0 {
            let pct = Double(b.cents - a.cents) / Double(abs(a.cents)) * 100
            let days = max(1, (b.d - a.d) / 86_400)
            netNote = "\(pct >= 0 ? "+" : "−")\(String(format: "%.1f", abs(pct)))% in \(days)d"
            netColor = pct >= 0 ? T.jade : T.coral
        }
        var cells = [StatCells.Cell(label: "Net worth", value: s.netWorth.cents.dollars.moneyWhole(), note: netNote, noteColor: netColor)]

        if let move = PortfolioDay.move(s) {
            let tint = move.cents >= 0 ? T.jade : T.coral
            cells.append(.init(
                label: live.book(for: companion.summary ?? s).isLive ? "Portfolio today · live" : "Portfolio today",
                value: "\(move.cents >= 0 ? "+" : "−")\(abs(move.cents).dollars.moneyWhole())",
                note: PortfolioDay.percent(move.pct),
                valueColor: tint,
                noteColor: tint
            ))
        } else if s.investments != nil || !s.positions.isEmpty {
            let value = s.investments?.valueCents ?? s.positions.reduce(0) { $0 + $1.cents }
            cells.append(.init(label: "Portfolio", value: value.dollars.moneyWhole(), note: "\(s.positions.count) position\(s.positions.count == 1 ? "" : "s")"))
        } else {
            cells.append(.init(
                label: "Per day",
                value: (totals.spentCents.dollars / Double(max(1, month.dayOfMonth))).moneyCompact(),
                note: "average spend"
            ))
        }
        return cells
    }

    // ── Needs you ──

    /// The first payback the Mac spotted, with the same Confirm the Shared tab
    /// sends. One row: the rest wait in Shared.
    @ViewBuilder
    private func needsYou(_ s: Summary) -> some View {
        // A suggestion already confirmed from here stops asking.
        let confirming = Set(companion.pending.compactMap { op -> String? in
            if case .recordSettlement(let o) = op { return o.txnId } else { return nil }
        })
        let suggestions = (s.settleSuggestions ?? []).filter { !confirming.contains($0.txnId) }
        if let sg = suggestions.first {
            let person = (s.people ?? []).first { $0.id == sg.personId }
            let who = person?.name.split(separator: " ").first.map(String.init) ?? "Someone"
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    (Text("\(who) paid you ").font(F.medium(15)).foregroundStyle(T.paper)
                        + Text("+\(abs(sg.cents).dollars.money())").font(F.mono(14)).foregroundStyle(T.muted))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(suggestions.count > 1 ? "\(sg.detail) · +\(suggestions.count - 1) more in Shared" : sg.detail)
                        .font(F.body(13))
                        .foregroundStyle(T.muted)
                        .lineLimit(2)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 6)
                Button {
                    Task {
                        await companion.submit(.recordSettlement(.init(
                            id: CompanionOp.newId(), ts: CompanionOp.now(),
                            personId: sg.personId, cents: sg.cents, txnId: sg.txnId
                        )))
                    }
                } label: {
                    Text("Confirm")
                        .font(F.semibold(14))
                        .foregroundStyle(T.onJade)
                        .padding(.horizontal, 18)
                        .frame(minHeight: 44)
                        .background(Capsule().fill(T.jade))
                }
                .buttonStyle(.pressScale)
                .accessibilityLabel("Confirm payback")
            }
            .transition(.opacity)
        }
    }

    // ── This month ──

    private func monthSection(_ s: Summary, totals: CompanionModel.Totals, rows: [CompanionModel.CategorySpend], pos: CompanionModel.BudgetPosition, month: CompanionModel.Month) -> some View {
        StatementSection(title: "This month") {
            FigureRow(label: "Spent so far", value: totals.spentCents.dollars.money()) {
                HStack(spacing: 6) {
                    if let delta = totals.deltaPct {
                        DeltaPill(pct: delta, size: 10.5)
                        Text("vs \(totals.priorCents.dollars.moneyCompact()) by day \(month.dayOfMonth) last month")
                    } else {
                        Text("no prior month to compare")
                    }
                }
                .font(F.body(12))
                .foregroundStyle(T.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            }
            FigureRow(label: "Per day", value: (totals.spentCents.dollars / Double(max(1, month.dayOfMonth))).moneyCompact()) {
                Text("average").font(F.body(12)).foregroundStyle(T.muted)
            }
            chart(s, totals: totals, rows: rows, pos: pos, month: month)
                .padding(.vertical, 14)
            Rule()
        }
    }

    private func chart(_ s: Summary, totals: CompanionModel.Totals, rows: [CompanionModel.CategorySpend], pos: CompanionModel.BudgetPosition, month: CompanionModel.Month) -> some View {
        // Against a budget, pace is the Mac's pace series — flexible budgets
        // only once any is fixed — and with no budgets it's all spend against
        // its own run rate.
        let flexible = pos.judgesFlexible && s.flexibleSpendByDay != nil
        let limit = flexible ? pos.flexibleLimit : pos.totalLimit
        let pace = CompanionModel.paceTotals(s, month: month)
        let paceSeries = limit > 0 ? pace : totals
        let headings = ["By day", "Cumulative vs pace", "Where it went"]
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(headings[mode]).font(F.body(13)).foregroundStyle(T.muted).lineLimit(1)
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
                        }, height: 100, showsAverage: true, highlightsLast: true)
                    } else {
                        empty("No spending recorded this month.")
                    }
                case 1:
                    if let paceSeries, paceSeries.cumulative.count > 1 {
                        VStack(alignment: .leading, spacing: 8) {
                            PaceChart(
                                cumulative: paceSeries.cumulative.map(\.dollars),
                                budget: limit.dollars,
                                daysInMonth: month.daysInMonth,
                                dayOfMonth: month.dayOfMonth,
                                height: 100
                            )
                            HStack(spacing: 14) {
                                legendKey(color: T.paper.opacity(0.5), dashed: true, label: limit > 0 ? "even pace to \(limit.dollars.moneyCompact())" : "run-rate pace")
                                legendKey(color: paceAhead(paceSeries, limit, month) ? T.coral : T.jade, dashed: false, label: limit > 0 ? (flexible ? "flexible spend" : "budgeted spend") : "spent")
                            }
                        }
                    } else {
                        empty(limit > 0 && pace == nil
                              ? "Update budgetr on your Mac to see the budget pace."
                              : "Not enough of the month yet to draw a pace.")
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
                                    LegendRow(color: sl.color, name: sl.name, value: sl.value.moneyCompact())
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

    private func paceAhead(_ totals: CompanionModel.Totals, _ limit: Int, _ month: CompanionModel.Month) -> Bool {
        guard limit > 0 else { return false }
        return Double(totals.spentCents) > Double(limit) * Double(month.dayOfMonth) / Double(month.daysInMonth)
    }

    private func legendKey(color: Color, dashed: Bool, label: String) -> some View {
        HStack(spacing: 6) {
            Path { p in
                p.move(to: CGPoint(x: 0, y: 1))
                p.addLine(to: CGPoint(x: 14, y: 1))
            }
            .stroke(color, style: StrokeStyle(lineWidth: dashed ? 1 : 2, lineCap: .round, dash: dashed ? [3, 3] : []))
            .frame(width: 14, height: 2)
            Text(label).font(F.body(11)).foregroundStyle(T.muted)
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
        Text(text).font(F.body(13)).foregroundStyle(T.muted).multilineTextAlignment(.center)
    }
}

/// Where the month's money actually went, by name — from the recent tape, so
/// it's a floor and says so.
private struct TopMerchants: View {
    let summary: Summary
    let month: CompanionModel.Month

    private struct Row: Identifiable {
        let id: String
        let cents: Int
        let visits: Int
        let category: String
    }

    var body: some View {
        let rows = merchants()
        if !rows.isEmpty {
            let top = Double(rows.first?.cents ?? 1)
            StatementSection(title: "Top merchants") {
                ForEach(rows) { r in
                    RuledRow {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(r.id).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                                Text("\(r.visits)×").font(F.mono(11)).foregroundStyle(T.muted)
                                Spacer(minLength: 6)
                                Text(r.cents.dollars.money()).font(F.mono(14)).foregroundStyle(T.paper)
                            }
                            TickBar(fraction: Double(r.cents) / top, color: T.brass)
                        }
                        .padding(.vertical, 9)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(r.id), \(r.cents.dollars.money()), \(r.visits) visit\(r.visits == 1 ? "" : "s")")
                }
                Text("From the recent tape — a floor, not the whole month.")
                    .font(F.body(12)).foregroundStyle(T.muted).padding(.top, 8)
            }
        }
    }

    private func merchants() -> [Row] {
        let index = CompanionModel.categoryIndex(summary)
        var sums: [String: (Int, Int, String)] = [:]
        for t in summary.recent where t.ts >= month.startSec && CompanionModel.isSpend(t, index) {
            let cur = sums[t.merchant] ?? (0, 0, t.category)
            sums[t.merchant] = (cur.0 + abs(t.cents), cur.1 + 1, cur.2)
        }
        return sums.map { Row(id: $0.key, cents: $0.value.0, visits: $0.value.1, category: $0.value.2) }
            .sorted { $0.cents > $1.cents }
            .prefix(5)
            .map { $0 }
    }
}

/// One category's month as a ruled row: dot, name, how it sits against its
/// budget, the amount and its share of the month.
private struct CategoryLine: View {
    let row: CompanionModel.CategorySpend
    /// Of the month's total spend.
    let share: Double
    let action: () -> Void

    private var tint: Color { row.budget.map { CompanionFormat.stateColor($0.state) } ?? T.brass }

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            RuledRow {
                HStack(spacing: 12) {
                    CategoryDot(color: tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.name).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                        if let b = row.budget, b.limitCents > 0 {
                            Text("\(CompanionFormat.percent(Double(row.cents) / Double(b.limitCents))) of \(b.limitCents.dollars.moneyCompact())")
                                .font(F.body(12))
                                .foregroundStyle(b.state == "over" ? T.coral : T.muted)
                        } else {
                            Text(row.partial ? "recent only · no budget" : "no budget")
                                .font(F.body(12)).foregroundStyle(T.muted)
                        }
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(row.cents.dollars.money()).font(F.mono(14)).foregroundStyle(T.paper)
                        Text("\(CompanionFormat.percent(share)) of spend").font(F.mono(11)).foregroundStyle(T.muted)
                    }
                }
                .padding(.vertical, 7)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens this month's transactions")
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
        let elapsed = Double(month.dayOfMonth) / Double(month.daysInMonth)
        var daily = [Double](repeating: 0, count: month.dayOfMonth)
        for t in txns {
            let d = CompanionModel.dayOfMonth(t.ts)
            if d >= 1 && d <= daily.count { daily[d - 1] += abs(t.cents).dollars }
        }

        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    GlyphTile(icon: row.icon, color: tint, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.name).font(F.display(21)).foregroundStyle(T.paper)
                        Text("\(month.label) · \(txns.count) transaction\(txns.count == 1 ? "" : "s")")
                            .font(F.body(11.5)).foregroundStyle(T.muted)
                    }
                }

                HStack(alignment: .center, spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        AnimatedMoney(value: row.cents.dollars, font: F.display(36))
                        Text(row.partial ? "this month · from recent transactions only" : "this month")
                            .font(F.body(12)).foregroundStyle(T.muted)
                    }
                    Spacer(minLength: 0)
                    if let b = row.budget, b.limitCents > 0 {
                        let used = Double(b.spentCents) / Double(b.limitCents)
                        RingGauge(fraction: used, color: tint, lineWidth: 7, marker: elapsed) {
                            Text(CompanionFormat.percent(used)).font(F.monoSemibold(13)).foregroundStyle(T.paper)
                        }
                        .frame(width: 66, height: 66)
                    }
                }
                .padding(.top, 18)
                .heroGlow(tint)

                if let b = row.budget, b.limitCents > 0 {
                    StripedMeter(fraction: Double(b.spentCents) / Double(b.limitCents), color: tint, marker: elapsed).padding(.top, 18)
                    HStack {
                        Text("\(b.spentCents.dollars.money()) of \(b.limitCents.dollars.money())")
                            .foregroundStyle(T.muted)
                        Spacer()
                        Text(b.spentCents > b.limitCents
                             ? "\((b.spentCents - b.limitCents).dollars.money()) over"
                             : "\((b.limitCents - b.spentCents).dollars.money()) left")
                            .foregroundStyle(b.spentCents > b.limitCents ? T.coral : T.jade)
                    }
                    .font(F.mono(11.5))
                    .padding(.top, 10)
                }

                if daily.filter({ $0 > 0 }).count > 1 {
                    Eyebrow("By day").padding(.top, 24)
                    MiniBars(values: daily, height: 52, color: tint).padding(.top, 10)
                    HStack {
                        Text("1").font(F.mono(9.5)).foregroundStyle(T.muted)
                        Spacer()
                        Text("day \(month.dayOfMonth)").font(F.mono(9.5)).foregroundStyle(T.muted)
                    }
                    .padding(.top, 4)
                }

                Eyebrow("Recent").padding(.top, 24).padding(.bottom, 4)
                ForEach(Array(txns.enumerated()), id: \.element.id) { i, t in
                    TxnRow(txn: t, index: index)
                        .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 50) } }
                }
                if txns.isEmpty {
                    Text("Nothing on the recent tape for this month.")
                        .font(F.body(12.5)).foregroundStyle(T.muted).padding(.vertical, 12)
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

    private static let kindOrder = ["depository", "investment", "credit", "loan", "other"]

    var body: some View {
        let assets = summary.accounts.reduce(0) { $0 + max(0, $1.cents) }
        let debts = summary.accounts.reduce(0) { $0 + max(0, -$1.cents) }
        let spark = summary.netWorth.spark
        let groups = Dictionary(grouping: summary.accounts, by: { Self.kindOrder.contains($0.kind) ? $0.kind : "other" })

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Eyebrow("Net worth")
                AnimatedMoney(value: summary.netWorth.cents.dollars, font: F.display(38))
                    .padding(.top, 8)
                RangedSparkLine(points: spark.map {
                    BarPoint(id: "\($0.d)", date: CompanionFormat.date($0.d), value: $0.cents.dollars)
                }, height: 84)
                .padding(.top, 12)

                if assets + debts > 0 {
                    StackedBar(slices: [
                        MixSlice(id: "a", name: "Assets", value: assets.dollars, color: T.jade),
                        MixSlice(id: "d", name: "Debts", value: debts.dollars, color: T.coral),
                    ], height: 8)
                    .padding(.top, 16)
                    HStack {
                        Label { Text("\(assets.dollars.moneyCompact()) assets") } icon: { Circle().fill(T.jade).frame(width: 6, height: 6) }
                        Spacer()
                        Label { Text("\(debts.dollars.moneyCompact()) debts") } icon: { Circle().fill(T.coral).frame(width: 6, height: 6) }
                    }
                    .font(F.mono(11))
                    .foregroundStyle(T.muted)
                    .padding(.top, 8)
                }

                if !summary.alerts.isEmpty {
                    Eyebrow("Alerts").padding(.top, 26).padding(.bottom, 8)
                    VStack(spacing: 8) {
                        ForEach(summary.alerts) { a in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(T.coral)
                                    .frame(width: 24, height: 24)
                                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(T.coral.opacity(0.14)))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(a.text).font(F.body(13)).foregroundStyle(T.paper)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text(CompanionFormat.day(a.ts)).font(F.mono(10)).foregroundStyle(T.muted)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(T.panel2))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(T.coral.opacity(0.3), lineWidth: 0.75))
                        }
                    }
                    Text("Dismiss alerts on your Mac.").font(F.body(11)).foregroundStyle(T.muted).padding(.top, 6)
                }

                ForEach(Self.kindOrder.filter { groups[$0] != nil }, id: \.self) { kind in
                    let accts = (groups[kind] ?? []).sorted { abs($0.cents) > abs($1.cents) }
                    let subtotal = accts.reduce(0) { $0 + $1.cents }
                    HStack {
                        Eyebrow(AccountsView.typeLabel(kind))
                        Spacer()
                        Text(subtotal.dollars.money()).font(F.mono(11)).foregroundStyle(subtotal < 0 ? T.coral : T.muted)
                    }
                    .padding(.top, 24)
                    .padding(.bottom, 6)
                    VStack(spacing: 0) {
                        ForEach(Array(accts.enumerated()), id: \.element.id) { i, a in
                            accountRow(a)
                                .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 52) } }
                        }
                    }
                    .padding(.horizontal, 12)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(T.panel2.opacity(0.6)))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(T.line, lineWidth: 0.75))
                }
            }
            .padding(22)
        }
        .bSheet([.large])
    }

    private func accountRow(_ a: Summary.Account) -> some View {
        let tint = a.cents < 0 ? T.coral : (a.kind == "investment" ? T.blue : T.brass)
        return HStack(spacing: 12) {
            Image(systemName: AccountsView.typeSymbol(a.kind))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(tint.opacity(0.13)))
            Text(a.name).font(F.medium(14)).foregroundStyle(T.paper).lineLimit(1)
            Spacer()
            Text(a.cents.dollars.money())
                .font(F.mono(13.5))
                .foregroundStyle(a.cents < 0 ? T.coral : T.paper)
        }
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }
}

// ── Activity ─────────────────────────────────────────────────────────

private enum ActivityFilter: Hashable { case all, spending, income, transfers, pending }

/// Where the numbers came from and how fresh they are — the quiet line under
/// the title when CompanionStatusLine has nothing more urgent to say.
private struct FreshnessLine: View {
    @EnvironmentObject private var companion: CompanionStore
    let asOf: Int

    var body: some View {
        if companion.syncError == nil && !companion.refreshing && !companion.isStale {
            HStack(spacing: 8) {
                Circle().fill(T.jade).frame(width: 7, height: 7).accessibilityHidden(true)
                Text("From your Mac, \(CompanionFormat.ago(Date(timeIntervalSince1970: TimeInterval(asOf))))")
                    .font(F.body(12))
                    .foregroundStyle(T.muted)
            }
        }
    }
}

/// A transaction on the tape: category dot, name, what it is, mono amount.
private struct ActivityRow: View {
    let txn: Summary.Txn
    let index: [String: Summary.Category]
    let dot: Color
    /// Already split with someone.
    let split: Bool

    var body: some View {
        let flow = CompanionModel.flow(txn, index)
        // Only real income is coloured as money arriving; a card payment's
        // credit side or a transfer in is money moving, not money earned.
        let inflow = txn.cents > 0 && flow == .income
        let transfer = flow == .transfer
        RuledRow {
            HStack(spacing: 12) {
                CategoryDot(color: dot)
                VStack(alignment: .leading, spacing: 2) {
                    Text(txn.merchant).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                    detail.font(F.body(12)).lineLimit(1)
                }
                Spacer(minLength: 8)
                // Summary convention: outflow negative. Inflows are the
                // exception, so they're the ones signed and coloured.
                Text((txn.cents > 0 ? "+" : "") + abs(txn.cents).dollars.money())
                    .font(F.mono(14))
                    .foregroundStyle(inflow ? T.jade : transfer ? T.muted : T.paper)
            }
            .padding(.vertical, 7)
        }
        .opacity(txn.pending ? 0.85 : 1)
        .accessibilityElement(children: .combine)
    }

    private var detail: Text {
        var t = Text("\(CompanionModel.name(txn.category, index)) · \(CompanionFormat.time(txn.ts))").foregroundStyle(T.muted)
        if txn.pending { t = t + Text(" · pending").foregroundStyle(T.brass) }
        if split { t = t + Text(" · split").foregroundStyle(T.muted) }
        return t
    }
}

struct CompanionActivityView: View {
    @EnvironmentObject private var companion: CompanionStore
    @State private var window = 30
    @State private var filter: ActivityFilter = .all
    @State private var sheet: SharedSheet?

    var body: some View {
        BScreen("Activity", eyebrow: "Recent transactions") {
            CompanionStatusLine()
            if let s = companion.summary {
                let index = CompanionModel.categoryIndex(s)
                let dots = categoryDotColors(s)
                let shown = s.recent.filter { matches($0, index) }
                FreshnessLine(asOf: s.asOf)
                StatCells(cells: monthCells(s, index: index)).rise(0)
                spendWindow(s).rise(1)
                FilterChips(options: [
                    .init(label: "All", value: .all, count: s.recent.count),
                    .init(label: "Spending", value: .spending, count: s.recent.filter { CompanionModel.isSpend($0, index) }.count, symbol: "arrow.up.right"),
                    .init(label: "Income", value: .income, count: s.recent.filter { CompanionModel.isIncome($0, index) }.count, symbol: "arrow.down.left"),
                    .init(label: "Transfers", value: .transfers, count: s.recent.filter { CompanionModel.flow($0, index) == .transfer }.count, symbol: "arrow.left.arrow.right"),
                    .init(label: "Pending", value: .pending, count: s.recent.filter(\.pending).count, symbol: "clock"),
                ], selection: $filter)
                .rise(2)
                flowLine(s, index: index)

                if shown.isEmpty {
                    EmptyState(symbol: "line.3.horizontal.decrease.circle", title: "Nothing here", message: "No recent transactions match this filter.")
                } else {
                    ForEach(Array(groups(shown).enumerated()), id: \.element.day) { i, g in
                        dayGroup(g, index: index, dots: dots).rise(3 + i)
                    }
                }
                Text("The \(s.recent.count) most recent — the full ledger stays on your Mac.")
                    .font(F.body(12))
                    .foregroundStyle(T.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
        .sheet(item: $sheet) { which in
            if let s = companion.summary { SharedSheetView(which: which, summary: s) }
        }
    }

    private func matches(_ t: Summary.Txn, _ index: [String: Summary.Category]) -> Bool {
        switch filter {
        case .all: return true
        case .spending: return CompanionModel.isSpend(t, index)
        case .income: return CompanionModel.isIncome(t, index)
        case .transfers: return CompanionModel.flow(t, index) == .transfer
        case .pending: return t.pending
        }
    }

    /// Out this month is the Mac's own daily series; In is the income on the
    /// recent tape since the 1st — a floor, and labelled as the tape.
    private func monthCells(_ s: Summary, index: [String: Summary.Category]) -> [StatCells.Cell] {
        let month = CompanionModel.Month()
        let tape = s.recent.filter { $0.ts >= month.startSec }
        let earned = tape.filter { CompanionModel.isIncome($0, index) }
        let inn = earned.reduce(0) { $0 + $1.cents }
        let out: StatCells.Cell
        if let series = s.spendByDay {
            out = .init(label: "Out in \(month.label)", value: CompanionModel.totals(series, month: month).spentCents.dollars.money())
        } else {
            let spent = tape.filter { CompanionModel.isSpend($0, index) }.reduce(0) { $0 - $1.cents }
            out = .init(label: "Out in \(month.label)", value: spent.dollars.money(), note: "recent tape")
        }
        return [
            out,
            .init(
                label: "In",
                value: "+\(inn.dollars.money())",
                note: "\(earned.count) deposit\(earned.count == 1 ? "" : "s") · recent tape",
                valueColor: T.jade
            ),
        ]
    }

    private func dayGroup(_ g: (day: String, ts: Int, txns: [Summary.Txn]), index: [String: Summary.Category], dots: [String: Color]) -> some View {
        // A day's totals are what was spent and earned — a card payment on
        // the same day would otherwise dwarf the coffee it paid for.
        let out = g.txns.filter { CompanionModel.isSpend($0, index) }.reduce(0) { $0 - $1.cents }
        let inn = g.txns.filter { CompanionModel.isIncome($0, index) }.reduce(0) { $0 + $1.cents }
        let relative = g.day == "Today" || g.day == "Yesterday"
        let net = [inn > 0 ? "+\(inn.dollars.money())" : nil, out > 0 ? "−\(out.dollars.money())" : nil]
            .compactMap { $0 }.joined(separator: "  ")
        let shared = Set((companion.summary?.shared ?? []).map(\.txnId))
        return VStack(spacing: 0) {
            RuleLabel(
                leading: relative ? "\(g.day) · \(CompanionFormat.weekday(g.ts))" : g.day,
                trailing: net.isEmpty ? nil : net,
                mono: true
            )
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            ForEach(g.txns) { t in
                ActivityRow(txn: t, index: index, dot: dots[t.category] ?? T.muted, split: shared.contains(t.id))
                    .contextMenu {
                        // Long-press a purchase to split it — the dinner you
                        // fronted is usually spotted here, not in Shared.
                        if CompanionModel.isSpend(t, index), !shared.contains(t.id) {
                            Button {
                                sheet = .split(txnId: t.id, personId: nil)
                            } label: {
                                Label("Split this bill", systemImage: "person.2")
                            }
                        }
                    }
            }
        }
    }

    private func groups(_ txns: [Summary.Txn]) -> [(day: String, ts: Int, txns: [Summary.Txn])] {
        var out: [(String, Int, [Summary.Txn])] = []
        for t in txns.sorted(by: { $0.ts > $1.ts }) {
            let key = CompanionFormat.day(t.ts)
            if var last = out.last, last.0 == key {
                last.2.append(t)
                out[out.count - 1] = last
            } else {
                out.append((key, t.ts, [t]))
            }
        }
        return out.map { (day: $0.0, ts: $0.1, txns: $0.2) }
    }

    /// Earned against spent across the recent tape. Transfers — card
    /// payments, moves between your own accounts, fronted shares — are
    /// neither, and are counted on their own so they're visibly not ignored.
    private func flowLine(_ s: Summary, index: [String: Summary.Category]) -> some View {
        let spent = s.recent.filter { CompanionModel.isSpend($0, index) }
        let earned = s.recent.filter { CompanionModel.isIncome($0, index) }
        let moved = s.recent.filter { CompanionModel.flow($0, index) == .transfer }
        let out = spent.reduce(0) { $0 - $1.cents }
        let inn = earned.reduce(0) { $0 + $1.cents }
        return (Text("On this tape  ")
            + Text("\(spent.count) purchase\(spent.count == 1 ? "" : "s") ") + Text(out.dollars.moneyCompact()).foregroundStyle(T.paper)
            + Text("  ·  \(earned.count) deposit\(earned.count == 1 ? "" : "s") ") + Text("+\(inn.dollars.moneyCompact())").foregroundStyle(T.jade)
            + Text("  ·  \(moved.count) transfer\(moved.count == 1 ? "" : "s"), not counted"))
            .font(F.mono(11))
            .foregroundStyle(T.muted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Spend over a chosen window, against the same length just before it.
    private func spendWindow(_ s: Summary) -> some View {
        let cutoff = Int(Date().timeIntervalSince1970) - window * 86_400
        let points = (s.spendByDay ?? []).filter { $0.d >= cutoff }
        let total = points.reduce(0) { $0 + $1.cents }
        // The same length of window just before this one.
        let prior = (s.spendByDay ?? []).filter { $0.d >= cutoff - window * 86_400 && $0.d < cutoff }
        let priorTotal = prior.reduce(0) { $0 + $1.cents }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Spending · \(window)d").font(F.body(13)).foregroundStyle(T.muted)
                    HStack(spacing: 8) {
                        Text(total.dollars.money())
                            .font(F.mono(14))
                            .foregroundStyle(T.paper)
                            .contentTransition(.numericText())
                        if priorTotal > 0 && prior.count >= window / 2 {
                            DeltaPill(pct: Double(total - priorTotal) / Double(priorTotal) * 100, size: 10.5)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
                Spacer()
                Segmented(options: [("7D", 7), ("30D", 30), ("90D", 90)], selection: $window)
                    .frame(width: 150)
            }
            if points.isEmpty {
                Text("No spending in this window.").font(F.body(13)).foregroundStyle(T.muted)
                    .frame(maxWidth: .infinity, minHeight: 64)
            } else {
                ScrubBars(points: points.map {
                    BarPoint(id: "\($0.d)", date: CompanionFormat.date($0.d), value: $0.cents.dollars)
                }, height: 64, showsAverage: true, highlightsLast: true)
                .id(window)
            }
        }
    }
}

// ── Budgets ──────────────────────────────────────────────────────────

struct CompanionBudgetsView: View {
    @EnvironmentObject private var companion: CompanionStore
    @State private var open: CompanionModel.CategorySpend?

    var body: some View {
        let month = CompanionModel.Month()
        let daysLeft = max(0, month.daysInMonth - month.dayOfMonth)

        BScreen("Budgets", eyebrow: "\(month.label) · \(daysLeft) day\(daysLeft == 1 ? "" : "s") left") {
            CompanionStatusLine()
            if let s = companion.summary {
                if s.budgets.isEmpty {
                    EmptyState(symbol: "chart.pie", title: "No budgets yet", message: "Set budgets on your Mac and they'll appear here, paced against the month.")
                        .rise(0)
                } else {
                    let pos = CompanionModel.budgetPosition(s)
                    let verdict = CompanionModel.paceVerdict(pos, dayOfMonth: month.dayOfMonth, daysInMonth: month.daysInMonth)
                    hero(pos, verdict: verdict).rise(0)
                    pace(s, pos: pos, month: month).rise(1)
                    figures(s, pos: pos, verdict: verdict, month: month, daysLeft: daysLeft).rise(2)
                    list(s, month: month).rise(3)
                }
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
        .sheet(item: $open) { row in
            if let s = companion.summary { CategorySpendSheet(row: row, summary: s, month: month) }
        }
    }

    /// Left across every budget, and the Mac's reading of the pace.
    private func hero(_ pos: CompanionModel.BudgetPosition, verdict: CompanionModel.PaceVerdict?) -> some View {
        let over = pos.left < 0
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                FigureText(cents: abs(pos.left), font: F.display(48), color: over ? T.coral : T.paper)
                Text(over ? "over" : "left").font(F.body(14)).foregroundStyle(T.muted)
            }
            .accessibilityElement(children: .combine)
            if let verdict { VerdictText(verdict.text) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The month so far: cumulative spend against the dashed even-pace line —
    /// flexible budgets only once the Mac marks any fixed and sends that split.
    @ViewBuilder
    private func pace(_ s: Summary, pos: CompanionModel.BudgetPosition, month: CompanionModel.Month) -> some View {
        let flexible = pos.judgesFlexible && s.flexibleSpendByDay != nil
        let limit = flexible ? pos.flexibleLimit : pos.totalLimit
        if let totals = CompanionModel.paceTotals(s, month: month), totals.cumulative.count > 1 {
            VStack(spacing: 6) {
                PaceChart(
                    cumulative: totals.cumulative.map(\.dollars),
                    budget: limit.dollars,
                    daysInMonth: month.daysInMonth,
                    dayOfMonth: month.dayOfMonth,
                    height: 96
                )
                HStack {
                    Text("1")
                    Spacer(minLength: 6)
                    Text("day \(month.dayOfMonth)").foregroundStyle(T.paper)
                    Spacer(minLength: 6)
                    Text("dashed: even pace to \(limit.dollars.moneyCompact())")
                }
                .font(F.mono(11))
                .foregroundStyle(T.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(flexible ? "Flexible spending" : "Budgeted spending") so far, \(totals.spentCents.dollars.money()) by day \(month.dayOfMonth), against an even pace to \(limit.dollars.money())")
        }
    }

    /// What the old overview carried: the daily allowance, how much of the
    /// month and the budget are gone, and how many budgets sit in each state.
    private func figures(_ s: Summary, pos: CompanionModel.BudgetPosition, verdict: CompanionModel.PaceVerdict?, month: CompanionModel.Month, daysLeft: Int) -> some View {
        let elapsed = Double(month.dayOfMonth) / Double(max(1, month.daysInMonth))
        let tone = verdict?.tone
        let paceNote = tone == .over ? "over" : tone == .warn ? "ahead of pace" : "on pace"
        let flexible = s.budgets.filter { !$0.isFixed }
        let counts = (
            ok: flexible.filter { $0.state == "ok" }.count,
            warn: flexible.filter { $0.state == "warn" }.count,
            over: s.budgets.filter { $0.spentCents > $0.limitCents || (!$0.isFixed && $0.state == "over") }.count
        )
        return VStack(alignment: .leading, spacing: 10) {
            StatCells(cells: [
                .init(label: "Per day",
                      value: daysLeft > 0 && pos.left > 0 ? (pos.left.dollars / Double(daysLeft)).moneyCompact() : "—",
                      note: "to spend"),
                .init(label: "Month gone", value: CompanionFormat.percent(elapsed), note: "\(daysLeft) day\(daysLeft == 1 ? "" : "s") left"),
                .init(label: "Budget used",
                      value: pos.totalLimit > 0 ? CompanionFormat.percent(Double(pos.totalSpent) / Double(pos.totalLimit)) : "—",
                      note: paceNote,
                      noteColor: tone?.color ?? T.muted),
            ])
            (Text("\(counts.ok)").foregroundStyle(T.jade) + Text(" on track  ·  ")
                + Text("\(counts.warn)").foregroundStyle(T.brass) + Text(" ahead of pace  ·  ")
                + Text("\(counts.over)").foregroundStyle(T.coral) + Text(" over"))
                .font(F.mono(11.5))
                .foregroundStyle(T.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func list(_ s: Summary, month: CompanionModel.Month) -> some View {
        let index = CompanionModel.categoryIndex(s)
        let elapsed = Double(month.dayOfMonth) / Double(max(1, month.daysInMonth))
        let ordered = budgetOrder(s.budgets)
        let fixed = ordered.filter(\.isFixed)
        let flexible = ordered.filter { !$0.isFixed }
        return VStack(spacing: 0) {
            if fixed.isEmpty {
                RuleLabel(leading: "\(ordered.count) budget\(ordered.count == 1 ? "" : "s")", trailing: "tick marks today")
                rows(ordered, index: index, elapsed: elapsed)
            } else {
                RuleLabel(leading: "Fixed", trailing: flexible.isEmpty ? nil : "tick marks today")
                    .accessibilityAddTraits(.isHeader)
                rows(fixed, index: index, elapsed: elapsed)
                if !flexible.isEmpty {
                    RuleLabel(leading: "Flexible")
                        .accessibilityAddTraits(.isHeader)
                        .padding(.top, 14)
                    rows(flexible, index: index, elapsed: elapsed)
                }
            }
        }
    }

    private func rows(_ budgets: [Summary.Budget], index: [String: Summary.Category], elapsed: Double) -> some View {
        ForEach(budgets, id: \.category) { b in
            BudgetLine(budget: b, name: CompanionModel.name(b.category, index), elapsed: elapsed) {
                open = spendRow(b, index)
            }
        }
    }
}

// ── Holdings ─────────────────────────────────────────────────────────

struct CompanionHoldingsView: View {
    @EnvironmentObject private var companion: CompanionStore
    @EnvironmentObject private var live: LiveQuotes
    @State private var openSymbol: String?

    var body: some View {
        // Values follow live quotes between syncs; positions the Mac sent no
        // price for (option legs, fixed-value holdings) stay as synced.
        let book = companion.summary.map { live.book(for: $0) }
        BScreen("Holdings", eyebrow: "Investments") {
            CompanionStatusLine()
            if let book {
                let s = book.summary
                if s.positions.isEmpty && s.investments == nil {
                    EmptyState(symbol: "chart.line.uptrend.xyaxis", title: "No holdings", message: "Investment accounts linked on your Mac show up here.")
                        .rise(0)
                } else {
                    header(s, book: book).rise(0)
                    if !s.positions.isEmpty { positions(s).rise(1) }
                    movers(s).rise(2)
                    if let inv = s.investments, !inv.sectors.isEmpty { sectors(inv, colors: sectorColors(s)).rise(3) }
                    Text("Read-only. Cost basis and lots stay on your Mac.")
                        .font(F.body(12)).foregroundStyle(T.muted).frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable {
            await companion.refresh(manual: true)
            await live.refresh(for: companion.summary, force: true)
        }
        .task { await live.follow { companion.summary } }
        .navigationDestination(item: $openSymbol) { symbol in
            if let s = companion.summary, let p = s.positions.first(where: { $0.symbol == symbol }) {
                PositionDetailView(position: p, summary: s)
            }
        }
    }

    private func open(_ symbol: String) {
        Haptics.tap()
        openSymbol = symbol
    }

    /// A sector keeps one colour on its bar segment and its row.
    private func sectorColors(_ s: Summary) -> [String: Color] {
        let order = s.investments?.sectors.map(\.sector) ?? Array(Set(s.positions.compactMap(\.sector))).sorted()
        return Dictionary(order.enumerated().map { ($1, T.chart[$0 % T.chart.count]) }, uniquingKeysWith: { a, _ in a })
    }

    private func header(_ s: Summary, book: CompanionModel.LiveBook) -> some View {
        let value = s.investments?.valueCents ?? s.positions.reduce(0) { $0 + $1.cents }
        let spark = s.investments?.spark ?? []
        return VStack(alignment: .leading, spacing: 8) {
            FigureText(cents: value, font: F.display(46))
            VerdictText(today(s))
            liveLine(book)
            if spark.count > 1 {
                RangedSparkLine(points: spark.map {
                    BarPoint(id: "\($0.d)", date: CompanionFormat.date($0.d), value: $0.cents.dollars)
                }, height: 96)
                .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Says plainly that the figure above is an estimate, how fresh it is, and
    /// how much of the book it covers. Absent when nothing is quoted: then the
    /// numbers are exactly the Mac's.
    @ViewBuilder
    private func liveLine(_ book: CompanionModel.LiveBook) -> some View {
        if book.isLive {
            let at = live.fetchedAt.map { $0.formatted(.dateTime.hour().minute()) } ?? "now"
            let scope = book.live.count < book.total
                ? "\(book.live.count) of \(book.total) positions, the rest as synced"
                : "all \(book.total) positions"
            let move = book.deltaCents
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Circle().fill(T.jade).frame(width: 7, height: 7).accessibilityHidden(true)
                Text("Live · quotes \(at) · \(scope) · \(move >= 0 ? "+" : "−")\(abs(move).dollars.money()) since your Mac synced")
                    .font(F.mono(11.5))
                    .foregroundStyle(T.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
        }
    }

    /// "Up $5.00 today, 0.82%." — from the day moves the Mac priced. Without
    /// any, the sentence is just what's held.
    private func today(_ s: Summary) -> Text {
        let held = "\(s.positions.count) position\(s.positions.count == 1 ? "" : "s")"
        guard let move = PortfolioDay.move(s) else { return Text("\(held), as your Mac last priced them.") }
        if move.cents == 0 { return Text("Flat today across \(held).") }
        let pct = String(format: "%.2f", abs(move.pct))
        let scope = move.priced < s.positions.count ? " across the \(move.priced) priced today" : ""
        return Text(move.cents > 0 ? "Up " : "Down ")
            + Text(abs(move.cents).dollars.money()).foregroundStyle(move.cents > 0 ? T.jade : T.coral)
            + Text(" today, \(pct)%\(scope).")
    }

    private func bpText(_ bp: Int) -> String {
        "\(bp >= 0 ? "+" : "−")\(String(format: "%.2f", Double(abs(bp)) / 100))%"
    }

    private func positions(_ s: Summary) -> some View {
        let total = max(1, s.positions.reduce(0) { $0 + $1.cents })
        let top = Double(max(1, s.positions.map(\.cents).max() ?? 1))
        return VStack(spacing: 0) {
            RuleLabel(leading: "\(s.positions.count) position\(s.positions.count == 1 ? "" : "s")", trailing: "value · today")
            ForEach(Array(s.positions.enumerated()), id: \.element.symbol) { _, p in
                let weight = CompanionFormat.percent(Double(p.cents) / Double(total))
                Button { open(p.symbol) } label: {
                    RuledRow {
                        HStack(spacing: 12) {
                            Text(CompanionFormat.ticker(p.symbol))
                                .font(F.mono(14))
                                .foregroundStyle(T.paper)
                                .lineLimit(1)
                                .frame(minWidth: 50, alignment: .leading)
                            HStack(spacing: 8) {
                                // Scaled to the largest holding, so the top row
                                // fills and the rest read against it.
                                TickBar(fraction: Double(p.cents) / top, color: T.brass)
                                Text(weight)
                                    .font(F.mono(11))
                                    .foregroundStyle(T.muted)
                                    .frame(minWidth: 32, alignment: .trailing)
                            }
                            VStack(alignment: .trailing, spacing: 1) {
                                Text(p.cents.dollars.money()).font(F.mono(14)).foregroundStyle(T.paper)
                                if let bp = p.dayBp {
                                    Text(bpText(bp)).font(F.mono(11)).foregroundStyle(bp >= 0 ? T.jade : T.coral)
                                }
                            }
                            .lineLimit(1)
                            .frame(minWidth: 96, alignment: .trailing)
                        }
                        .padding(.vertical, 7)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(p.name ?? p.symbol), \(p.cents.dollars.money()), \(weight) of the portfolio\(p.dayBp.map { ", \(bpText($0)) today" } ?? "")")
                .accessibilityHint("Opens the price chart and details")
            }
        }
    }

    /// Today's biggest move each way, as the Mac priced it.
    @ViewBuilder
    private func movers(_ s: Summary) -> some View {
        let priced = s.positions.filter { $0.dayBp != nil }
        let up = priced.max { ($0.dayBp ?? 0) < ($1.dayBp ?? 0) }
        let down = priced.min { ($0.dayBp ?? 0) < ($1.dayBp ?? 0) }
        let picks: [(label: String, position: Summary.Position)] =
            (up.map { ($0.dayBp ?? 0) > 0 ? [("Top gainer", $0)] : [] } ?? [])
            + (down.map { ($0.dayBp ?? 0) < 0 ? [("Top loser", $0)] : [] } ?? [])
        if !picks.isEmpty {
            StatCells(cells: picks.map { pick in
                let bp = pick.position.dayBp ?? 0
                return .init(
                    label: pick.label,
                    value: CompanionFormat.ticker(pick.position.symbol),
                    note: bpText(bp),
                    noteColor: bp >= 0 ? T.jade : T.coral
                )
            })
            .cellTaps(picks.map { pick in
                ("\(pick.label), \(pick.position.symbol). Opens the price chart and details", { open(pick.position.symbol) })
            })
        }
    }

    private func sectors(_ inv: Summary.Investments, colors: [String: Color]) -> some View {
        let slices = inv.sectors.map { sec in
            MixSlice(id: sec.sector, name: sec.sector, value: sec.cents.dollars, color: colors[sec.sector] ?? T.muted)
        }
        return StatementSection(title: "Allocation", count: slices.count) {
            StackedBar(slices: slices, height: 8).padding(.vertical, 14)
            Rule()
            ForEach(slices) { sl in
                RuledRow(minHeight: 44) {
                    HStack(spacing: 12) {
                        CategoryDot(color: sl.color)
                        Text(sl.name).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(inv.valueCents > 0 ? "\(Int((sl.value / inv.valueCents.dollars * 100).rounded()))%" : "—")
                            .font(F.mono(11)).foregroundStyle(T.muted)
                        Text(sl.value.moneyCompact())
                            .font(F.mono(14)).foregroundStyle(T.paper)
                            .frame(minWidth: 64, alignment: .trailing)
                    }
                }
                .accessibilityElement(children: .combine)
            }
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
            LinkCard().rise(0)

            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "Sync")
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        row("clock.arrow.circlepath", "Last sync", CompanionFormat.ago(companion.lastSyncAt))
                        row(companion.syncError == nil ? "checkmark.seal" : "exclamationmark.triangle",
                            "Status", companion.syncError ?? "Healthy",
                            tint: companion.syncError == nil ? T.jade : T.brass)
                        if let asOf = companion.summary?.asOf {
                            row("desktopcomputer", "Mac's numbers from", CompanionFormat.ago(Date(timeIntervalSince1970: TimeInterval(asOf))), last: true)
                        }
                    }
                }
            }
            .rise(1)

            if let s = companion.summary {
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader(title: "On this phone")
                    HStack(spacing: 8) {
                        StatTile(label: "Accounts", value: "\(s.accounts.count)", note: "linked")
                        StatTile(label: "Budgets", value: "\(s.budgets.count)", note: "this month")
                        StatTile(label: "Recent", value: "\(s.recent.count)", note: "transactions")
                    }
                }
                .rise(2)
            }

            PillButton(title: companion.refreshing ? "Syncing…" : "Sync now", systemImage: "arrow.clockwise", role: .primary) {
                Task { await companion.refresh(manual: true) }
            }
            .disabled(companion.refreshing)
            .opacity(companion.refreshing ? 0.6 : 1)
            .rise(3)

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(T.brass)
                Text("Your Mac is the source of truth. This phone holds an end-to-end encrypted snapshot — the relay in between can never read it, and edits stay on the Mac.")
                    .font(F.body(12))
                    .foregroundStyle(T.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(T.brass.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(T.brass.opacity(0.2), lineWidth: 0.75))
            .rise(4)

            PillButton(title: "Unpair this phone", systemImage: "link.badge.plus", role: .destructive) {
                Haptics.warning()
                confirmingUnpair = true
            }
            .rise(5)

            BrandMark(size: 22)
                .opacity(0.5)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
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

    private func row(_ symbol: String, _ label: String, _ value: String, tint: Color = T.paper, last: Bool = false) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(T.muted)
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(T.panel2))
            Text(label).font(F.body(14)).foregroundStyle(T.muted)
            Spacer()
            Text(value).font(F.mono(12.5)).foregroundStyle(tint).lineLimit(1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .overlay(alignment: .bottom) { if !last { Hairline().padding(.leading, 54) } }
    }
}

/// The pairing, drawn: phone and Mac joined by an encrypted link that carries
/// a travelling pulse while it's healthy.
private struct LinkCard: View {
    @EnvironmentObject private var companion: CompanionStore
    @State private var flow: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var healthy: Bool { companion.syncError == nil && !companion.isStale }

    var body: some View {
        let tint = healthy ? T.jade : T.brass
        Card(padding: 18) {
            VStack(spacing: 14) {
                HStack(spacing: 0) {
                    device("iphone", "This phone")
                    ZStack {
                        Path { p in
                            p.move(to: CGPoint(x: 0, y: 1))
                            p.addLine(to: CGPoint(x: 400, y: 1))
                        }
                        .stroke(tint.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [4, 5], dashPhase: -flow))
                        .frame(height: 2)
                        .clipped()
                        Image(systemName: "lock.fill")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(tint)
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(T.panel2))
                            .overlay(Circle().strokeBorder(tint.opacity(0.4), lineWidth: 0.75))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 18)
                    device("desktopcomputer", "Your Mac")
                }
                HStack(spacing: 6) {
                    PulseDot(color: tint, size: 6).frame(width: 10, height: 10)
                    Text(healthy ? "Paired · end-to-end encrypted" : (companion.syncError ?? "Waiting on your Mac"))
                        .font(F.body(12))
                        .foregroundStyle(healthy ? T.muted : T.brass)
                        .lineLimit(1)
                }
            }
        }
        .heroGlow(tint, alignment: .topTrailing)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { flow = 18 }
        }
        .accessibilityElement(children: .combine)
    }

    private func device(_ symbol: String, _ label: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(T.paper)
                .frame(width: 52, height: 52)
                .background(
                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                        .fill(LinearGradient(colors: [T.panel2, T.panel], startPoint: .top, endPoint: .bottom))
                )
                .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).strokeBorder(T.lineStrong, lineWidth: 0.75))
            Text(label).font(F.body(11)).foregroundStyle(T.muted)
        }
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
