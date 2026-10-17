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
                .foregroundStyle(T.faint)
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

        SpendingHero(totals: totals, limit: limit, month: month).rise(0)

        // The worst alert, stated. A dot on an icon is not how you tell someone
        // a bank connection has been dead for weeks.
        if let first = s.alerts.first {
            Button {
                Haptics.tap()
                showingWallet = true
            } label: {
                NoticeBanner(
                    symbol: "exclamationmark.triangle.fill",
                    text: first.text,
                    badge: s.alerts.count > 1 ? "+\(s.alerts.count - 1)" : nil
                )
            }
            .buttonStyle(.pressScale)
            .rise(0)
        }

        HStack(spacing: 8) {
            Button {
                Haptics.tap()
                showingWallet = true
            } label: {
                StatTile(label: "Net worth", value: s.netWorth.cents.dollars.moneyCompact(), note: "\(s.accounts.count) accounts ›")
            }
            .buttonStyle(.pressScale)
            StatTile(
                label: left < 0 ? "Over budget" : "Left",
                value: limit > 0 ? abs(left).dollars.moneyCompact() : "—",
                tint: left < 0 ? T.coral : T.jade,
                note: limit > 0 ? "of \(limit.dollars.moneyCompact())" : "no budgets set"
            )
            StatTile(
                label: "Per day",
                value: (totals.spentCents.dollars / Double(max(1, month.dayOfMonth))).moneyCompact(),
                note: "average"
            )
        }
        .rise(1)

        chartCard(totals: totals, rows: rows, limit: limit, month: month).rise(2)

        TopMerchants(summary: s, month: month).rise(3)

        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(
                title: "Categories",
                detail: "\(rows.count)",
                action: rows.count > 6 ? (showingAll ? "Fewer" : "All \(rows.count) ›", { withAnimation(M.settle) { showingAll.toggle() } }) : nil
            )
            if rows.isEmpty {
                Text("No spending categorised this month yet.").font(F.body(12.5)).foregroundStyle(T.faint)
            } else {
                let elapsed = Double(month.dayOfMonth) / Double(month.daysInMonth)
                // Budgeted spend and the tape don't always sum to the daily
                // series, so shares are of whichever is larger — never over 100%.
                let whole = max(totals.spentCents, rows.reduce(0) { $0 + $1.cents }, 1)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(Array((showingAll ? rows : Array(rows.prefix(6))).enumerated()), id: \.element.id) { i, row in
                        CategorySpendTile(row: row, share: Double(row.cents) / Double(whole), elapsed: elapsed) {
                            openCategory = row
                        }
                        .rise(5 + i)
                    }
                }
            }
        }
        .padding(.top, 4)
        .rise(4)
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
                            }, height: 100, showsAverage: true, highlightsLast: true)
                        } else {
                            empty("No spending recorded this month.")
                        }
                    case 1:
                        if totals.cumulative.count > 1 {
                            VStack(alignment: .leading, spacing: 8) {
                                PaceChart(
                                    cumulative: totals.cumulative.map(\.dollars),
                                    budget: limit.dollars,
                                    daysInMonth: month.daysInMonth,
                                    dayOfMonth: month.dayOfMonth,
                                    height: 100
                                )
                                HStack(spacing: 14) {
                                    legendKey(color: T.paper.opacity(0.5), dashed: true, label: limit > 0 ? "even pace to \(limit.dollars.moneyCompact())" : "run-rate pace")
                                    legendKey(color: paceAhead(totals, limit, month) ? T.coral : T.jade, dashed: false, label: "spent")
                                }
                            }
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
            Text(label).font(F.body(10.5)).foregroundStyle(T.faint)
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

/// Month to date, said three ways: the figure, how it compares with the same
/// slice of last month, and — when there are budgets — a ring of how much of
/// the allowance is gone with a tick for how much of the month is.
private struct SpendingHero: View {
    let totals: CompanionModel.Totals
    let limit: Int
    let month: CompanionModel.Month

    var body: some View {
        let elapsed = Double(month.dayOfMonth) / Double(month.daysInMonth)
        let used = limit > 0 ? Double(totals.spentCents) / Double(limit) : 0
        let tint = CompanionFormat.paceColor(spent: totals.spentCents, limit: limit, elapsed: elapsed)

        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("SPENT THIS MONTH")
                    .font(F.mono(10))
                    .tracking(1.2)
                    .foregroundStyle(T.muted)
                AnimatedMoney(value: totals.spentCents.dollars, font: F.display(44))
                HStack(spacing: 8) {
                    if let delta = totals.deltaPct {
                        DeltaPill(pct: delta)
                        Text("vs \(totals.priorCents.dollars.moneyCompact()) by day \(month.dayOfMonth) last month")
                            .font(F.body(12)).foregroundStyle(T.faint)
                    } else {
                        Text("no prior month to compare").font(F.body(12)).foregroundStyle(T.faint)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 0)
            if limit > 0 {
                RingGauge(fraction: used, color: tint, lineWidth: 9, marker: elapsed) {
                    VStack(spacing: 0) {
                        Text(CompanionFormat.percent(used))
                            .font(F.monoSemibold(16))
                            .foregroundStyle(T.paper)
                        Text("of budget")
                            .font(F.body(9))
                            .foregroundStyle(T.faint)
                    }
                }
                .frame(width: 88, height: 88)
                .accessibilityLabel("\(CompanionFormat.percent(used)) of budget used, \(CompanionFormat.percent(elapsed)) of the month gone")
            }
        }
        .padding(.vertical, 4)
        .heroGlow(tint)
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
            let index = CompanionModel.categoryIndex(summary)
            let top = Double(rows.first?.cents ?? 1)
            TitledCard("Top merchants", trailing: "recent tape") {
                VStack(spacing: 12) {
                    ForEach(rows) { r in
                        HStack(spacing: 12) {
                            MerchantAvatar(name: r.id, icon: index[r.category]?.icon, size: 32)
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(r.id).font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                                    Spacer(minLength: 6)
                                    Text(r.cents.dollars.money()).font(F.mono(12.5)).foregroundStyle(T.paper)
                                }
                                HStack(spacing: 8) {
                                    SlimMeter(fraction: Double(r.cents) / top, color: T.brass.opacity(0.85), height: 3)
                                    Text("\(r.visits)×").font(F.mono(10)).foregroundStyle(T.faint).frame(width: 22, alignment: .trailing)
                                }
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
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

private struct CategorySpendTile: View {
    let row: CompanionModel.CategorySpend
    /// Of the month's total spend.
    let share: Double
    let elapsed: Double
    let action: () -> Void

    private var tint: Color { row.budget.map { CompanionFormat.stateColor($0.state) } ?? T.brass }

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    GlyphTile(icon: row.icon, color: tint, size: 28)
                    Spacer(minLength: 4)
                    Text(CompanionFormat.percent(share))
                        .font(F.mono(10))
                        .foregroundStyle(T.faint)
                        .padding(.top, 2)
                }
                Text(row.name)
                    .font(F.semibold(11.5))
                    .foregroundStyle(T.muted)
                    .lineLimit(1)
                    .padding(.top, 10)
                Text(row.cents.dollars.moneyCompact())
                    .font(F.monoSemibold(19))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.top, 2)
                Spacer(minLength: 8)
                if let b = row.budget, b.limitCents > 0 {
                    StripedMeter(fraction: Double(row.cents) / Double(b.limitCents), color: tint, height: 6, marker: elapsed)
                    Text("\(CompanionFormat.percent(Double(row.cents) / Double(b.limitCents))) of \(b.limitCents.dollars.moneyCompact())")
                        .font(F.body(10))
                        .foregroundStyle(b.state == "over" ? T.coral : T.faint)
                        .padding(.top, 6)
                } else {
                    Text(row.partial ? "recent only · no budget" : "no budget")
                        .font(F.body(10)).foregroundStyle(T.faint)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: T.radiusSmall, style: .continuous)
                    .fill(LinearGradient(colors: [tint.opacity(0.07), T.panel.opacity(0.8)], startPoint: .topLeading, endPoint: .bottomTrailing))
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
                            .font(F.body(11.5)).foregroundStyle(T.faint)
                    }
                }

                HStack(alignment: .center, spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        AnimatedMoney(value: row.cents.dollars, font: F.display(36))
                        Text(row.partial ? "this month · from recent transactions only" : "this month")
                            .font(F.body(12)).foregroundStyle(T.faint)
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
                        Text("1").font(F.mono(9.5)).foregroundStyle(T.faint)
                        Spacer()
                        Text("day \(month.dayOfMonth)").font(F.mono(9.5)).foregroundStyle(T.faint)
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

    private static let kindOrder = ["depository", "investment", "credit", "loan", "other"]

    var body: some View {
        let assets = summary.accounts.reduce(0) { $0 + max(0, $1.cents) }
        let debts = summary.accounts.reduce(0) { $0 + max(0, -$1.cents) }
        let spark = summary.netWorth.spark
        let change: Double? = {
            guard let a = spark.first?.cents, let b = spark.last?.cents, a != 0 else { return nil }
            return Double(b - a) / Double(abs(a)) * 100
        }()
        let groups = Dictionary(grouping: summary.accounts, by: { Self.kindOrder.contains($0.kind) ? $0.kind : "other" })

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Eyebrow("Net worth")
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    AnimatedMoney(value: summary.netWorth.cents.dollars, font: F.display(38))
                    if let change {
                        DeltaPill(pct: change, upIsGood: true)
                    }
                }
                .padding(.top, 8)
                if change != nil {
                    Text("over the last \(spark.count) days").font(F.body(11.5)).foregroundStyle(T.faint).padding(.top, 2)
                }
                SparkLine(points: spark.map {
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
                                    Text(CompanionFormat.day(a.ts)).font(F.mono(10)).foregroundStyle(T.faint)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(T.panel2))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(T.coral.opacity(0.3), lineWidth: 0.75))
                        }
                    }
                    Text("Dismiss alerts on your Mac.").font(F.body(11)).foregroundStyle(T.faint).padding(.top, 6)
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
                let shown = s.recent.filter { matches($0, index) }
                spendCard(s).rise(0)
                flowTiles(s, index: index).rise(1)
                FilterChips(options: [
                    .init(label: "All", value: .all, count: s.recent.count),
                    .init(label: "Spending", value: .spending, count: s.recent.filter { CompanionModel.isSpend($0, index) }.count, symbol: "arrow.up.right"),
                    .init(label: "Income", value: .income, count: s.recent.filter { CompanionModel.isIncome($0, index) }.count, symbol: "arrow.down.left"),
                    .init(label: "Transfers", value: .transfers, count: s.recent.filter { CompanionModel.flow($0, index) == .transfer }.count, symbol: "arrow.left.arrow.right"),
                    .init(label: "Pending", value: .pending, count: s.recent.filter(\.pending).count, symbol: "clock"),
                ], selection: $filter)
                .rise(2)

                if shown.isEmpty {
                    Card {
                        EmptyState(symbol: "line.3.horizontal.decrease.circle", title: "Nothing here", message: "No recent transactions match this filter.")
                    }
                } else {
                    ForEach(Array(groups(shown).enumerated()), id: \.element.day) { i, g in
                        dayGroup(g, index: index).rise(3 + i)
                    }
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

    private func dayGroup(_ g: (day: String, ts: Int, txns: [Summary.Txn]), index: [String: Summary.Category]) -> some View {
        // A day's totals are what was spent and earned — a card payment on
        // the same day would otherwise dwarf the coffee it paid for.
        let out = g.txns.filter { CompanionModel.isSpend($0, index) }.reduce(0) { $0 - $1.cents }
        let inn = g.txns.filter { CompanionModel.isIncome($0, index) }.reduce(0) { $0 + $1.cents }
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(g.day).font(F.semibold(13.5)).foregroundStyle(T.paper)
                if g.day == "Today" || g.day == "Yesterday" {
                    Text(CompanionFormat.weekday(g.ts)).font(F.body(11.5)).foregroundStyle(T.faint)
                }
                Spacer()
                if inn > 0 { Text("+\(inn.dollars.moneyCompact())").font(F.mono(10.5)).foregroundStyle(T.jade) }
                if out > 0 { Text("−\(out.dollars.money())").font(F.mono(10.5)).foregroundStyle(T.muted) }
            }
            .padding(.horizontal, 4)
            Card(padding: 0) {
                VStack(spacing: 0) {
                    ForEach(Array(g.txns.enumerated()), id: \.element.id) { j, t in
                        TxnRow(txn: t, index: index)
                            .padding(.horizontal, 14)
                            .background(T.panel.opacity(0.001))
                            .contextMenu {
                                // Long-press a purchase to split it — the dinner you
                                // fronted is usually spotted here, not in Shared.
                                if CompanionModel.isSpend(t, index), !(companion.summary?.shared ?? []).contains(where: { $0.txnId == t.id }) {
                                    Button {
                                        sheet = .split(txnId: t.id, personId: nil)
                                    } label: {
                                        Label("Split this bill", systemImage: "person.2")
                                    }
                                }
                            }
                            .overlay(alignment: .top) { if j > 0 { Hairline().padding(.leading, 64) } }
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
    private func flowTiles(_ s: Summary, index: [String: Summary.Category]) -> some View {
        let spent = s.recent.filter { CompanionModel.isSpend($0, index) }
        let earned = s.recent.filter { CompanionModel.isIncome($0, index) }
        let moved = s.recent.filter { CompanionModel.flow($0, index) == .transfer }
        let out = spent.reduce(0) { $0 - $1.cents }
        let inn = earned.reduce(0) { $0 + $1.cents }
        return HStack(spacing: 8) {
            StatTile(label: "Income", value: inn.dollars.moneyCompact(), tint: T.jade, note: "\(earned.count) deposit\(earned.count == 1 ? "" : "s")")
            StatTile(label: "Spent", value: out.dollars.moneyCompact(), note: "\(spent.count) purchase\(spent.count == 1 ? "" : "s")")
            StatTile(label: "Transfers", value: "\(moved.count)", tint: T.muted, note: "not counted")
        }
    }

    private func spendCard(_ s: Summary) -> some View {
        let cutoff = Int(Date().timeIntervalSince1970) - window * 86_400
        let points = (s.spendByDay ?? []).filter { $0.d >= cutoff }
        let total = points.reduce(0) { $0 + $1.cents }
        // The same length of window just before this one.
        let prior = (s.spendByDay ?? []).filter { $0.d >= cutoff - window * 86_400 && $0.d < cutoff }
        let priorTotal = prior.reduce(0) { $0 + $1.cents }
        return Card(padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Eyebrow("Spending · \(window)d")
                        HStack(spacing: 8) {
                            Text(total.dollars.money())
                                .font(F.monoSemibold(20))
                                .foregroundStyle(T.paper)
                                .contentTransition(.numericText())
                            if priorTotal > 0 && prior.count >= window / 2 {
                                DeltaPill(pct: Double(total - priorTotal) / Double(priorTotal) * 100, size: 10.5)
                            }
                        }
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
                    }, height: 64, showsAverage: true, highlightsLast: true)
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
                    overview(s, month: month, daysLeft: daysLeft).rise(0)
                    list(s, month: month).rise(1)
                }
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
    }

    private func overview(_ s: Summary, month: CompanionModel.Month, daysLeft: Int) -> some View {
        let spent = s.budgets.reduce(0) { $0 + $1.spentCents }
        let limit = s.budgets.reduce(0) { $0 + $1.limitCents }
        let left = limit - spent
        let elapsed = Double(month.dayOfMonth) / Double(month.daysInMonth)
        // The ring is the whole month's pace; the per-budget states sit beside
        // it, so one blown category doesn't paint a healthy month red.
        let tint = CompanionFormat.paceColor(spent: spent, limit: limit, elapsed: elapsed)
        let paceNote = spent > limit ? "over" : tint == T.brass ? "ahead of pace" : "on pace"
        let counts = (
            ok: s.budgets.filter { $0.state == "ok" }.count,
            warn: s.budgets.filter { $0.state == "warn" }.count,
            over: s.budgets.filter { $0.state == "over" }.count
        )

        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 18) {
                    RingGauge(fraction: limit > 0 ? Double(spent) / Double(limit) : 0, color: tint, lineWidth: 12, marker: elapsed) {
                        VStack(spacing: 1) {
                            Text(abs(left).dollars.moneyCompact())
                                .font(F.monoSemibold(18))
                                .foregroundStyle(left < 0 ? T.coral : T.paper)
                                .contentTransition(.numericText())
                            Text(left < 0 ? "over" : "left")
                                .font(F.body(10.5))
                                .foregroundStyle(T.faint)
                        }
                    }
                    .frame(width: 124, height: 124)

                    VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(spent.dollars.moneyWhole())
                                .font(F.display(26))
                                .foregroundStyle(T.paper)
                            Text("of \(limit.dollars.moneyWhole())")
                                .font(F.body(12)).foregroundStyle(T.faint)
                        }
                        VStack(alignment: .leading, spacing: 5) {
                            stateLine(T.jade, "\(counts.ok) on track")
                            stateLine(T.brass, "\(counts.warn) ahead of pace")
                            stateLine(T.coral, "\(counts.over) over")
                        }
                    }
                    Spacer(minLength: 0)
                }

                HStack(spacing: 8) {
                    StatTile(label: "Per day", value: daysLeft > 0 && left > 0 ? (left.dollars / Double(daysLeft)).moneyCompact() : "—", tint: T.jade, note: "to spend")
                    StatTile(label: "Month gone", value: CompanionFormat.percent(elapsed), note: "\(daysLeft) days left")
                    StatTile(label: "Budget used", value: limit > 0 ? CompanionFormat.percent(Double(spent) / Double(limit)) : "—", tint: tint, note: paceNote)
                }
            }
        }
        .heroGlow(tint)
    }

    private func stateLine(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 7) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(text).font(F.body(12)).foregroundStyle(T.muted)
        }
    }

    private func list(_ s: Summary, month: CompanionModel.Month) -> some View {
        let index = CompanionModel.categoryIndex(s)
        let elapsed = Double(month.dayOfMonth) / Double(month.daysInMonth)
        let rank = ["over": 0, "warn": 1, "ok": 2]
        let ordered = s.budgets.sorted {
            let a = rank[$0.state] ?? 3, b = rank[$1.state] ?? 3
            if a != b { return a < b }
            return Double($0.spentCents) / Double(max(1, $0.limitCents)) > Double($1.spentCents) / Double(max(1, $1.limitCents))
        }
        return TitledCard("By category", accessory: {
            HStack(spacing: 5) {
                Capsule().fill(T.paper.opacity(0.85)).frame(width: 2, height: 10)
                Text("today's pace").font(F.mono(10.5)).foregroundStyle(T.faint)
            }
        }) {
            VStack(spacing: 0) {
                ForEach(Array(ordered.enumerated()), id: \.element.category) { i, b in
                    budgetRow(b, index: index, elapsed: elapsed)
                        .overlay(alignment: .top) { if i > 0 { Hairline() } }
                }
            }
            .padding(.vertical, -12)
        }
    }

    private func budgetRow(_ b: Summary.Budget, index: [String: Summary.Category], elapsed: Double) -> some View {
        let color = CompanionFormat.stateColor(b.state)
        let used = b.limitCents > 0 ? Double(b.spentCents) / Double(b.limitCents) : 0
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                GlyphTile(icon: index[b.category]?.icon, color: color, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(CompanionModel.name(b.category, index))
                        .font(F.medium(14)).foregroundStyle(T.paper).lineLimit(1)
                    Text(b.spentCents.dollars.moneyWhole())
                        .font(F.mono(11.5)).foregroundStyle(b.state == "over" ? T.coral : T.muted)
                    + Text(" / \(b.limitCents.dollars.moneyWhole())")
                        .font(F.mono(11.5)).foregroundStyle(T.faint)
                }
                Spacer(minLength: 8)
                Text(CompanionFormat.percent(used))
                    .font(F.monoSemibold(12))
                    .foregroundStyle(color)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(color.opacity(0.13)))
            }
            StripedMeter(fraction: used, color: color, height: 10, marker: elapsed)
            Text(b.spentCents > b.limitCents
                 ? "\((b.spentCents - b.limitCents).dollars.money()) over"
                 : "\((b.limitCents - b.spentCents).dollars.money()) left\(b.state == "warn" ? " · ahead of pace" : "")")
                .font(F.body(11.5))
                .foregroundStyle(b.state == "ok" ? T.faint : color)
        }
        .padding(.vertical, 13)
        .accessibilityElement(children: .combine)
    }
}

// ── Holdings ─────────────────────────────────────────────────────────

struct CompanionHoldingsView: View {
    @EnvironmentObject private var companion: CompanionStore
    @State private var openSymbol: String?

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
                    let colors = sectorColors(s)
                    header(s).rise(0)
                    movers(s).rise(1)
                    if let inv = s.investments, !inv.sectors.isEmpty { sectors(inv, colors: colors).rise(2) }
                    positions(s, colors: colors).rise(3)
                    Text("Read-only. Cost basis and lots stay on your Mac.")
                        .font(F.body(11.5)).foregroundStyle(T.faint).frame(maxWidth: .infinity)
                }
            } else {
                AwaitingSummary().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
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

    /// A sector keeps one colour on the donut, the bar and every position.
    private func sectorColors(_ s: Summary) -> [String: Color] {
        let order = s.investments?.sectors.map(\.sector) ?? Array(Set(s.positions.compactMap(\.sector))).sorted()
        return Dictionary(order.enumerated().map { ($1, T.chart[$0 % T.chart.count]) }, uniquingKeysWith: { a, _ in a })
    }

    private func header(_ s: Summary) -> some View {
        let value = s.investments?.valueCents ?? s.positions.reduce(0) { $0 + $1.cents }
        let spark = s.investments?.spark ?? []
        let change: Double? = {
            guard let a = spark.first?.cents, let b = spark.last?.cents, a > 0 else { return nil }
            return Double(b - a) / Double(a) * 100
        }()
        return VStack(alignment: .leading, spacing: 6) {
            Text("PORTFOLIO VALUE").font(F.mono(10)).tracking(1.2).foregroundStyle(T.muted)
            AnimatedMoney(value: value.dollars, font: F.display(44))
            HStack(spacing: 8) {
                if let change {
                    DeltaPill(pct: change, upIsGood: true)
                    Text("\(spark.count)d").font(F.mono(11)).foregroundStyle(T.faint)
                    Text("·").foregroundStyle(T.faint)
                }
                Text("\(s.positions.count) position\(s.positions.count == 1 ? "" : "s")")
                    .font(F.body(12.5)).foregroundStyle(T.faint)
            }
            if spark.count > 1 {
                SparkLine(points: spark.map {
                    BarPoint(id: "\($0.d)", date: CompanionFormat.date($0.d), value: $0.cents.dollars)
                }, height: 96)
                .padding(.top, 6)
            }
        }
        .heroGlow((change ?? 0) >= 0 ? T.jade : T.coral)
    }

    /// Today's biggest move each way, as the Mac priced it.
    @ViewBuilder
    private func movers(_ s: Summary) -> some View {
        let priced = s.positions.filter { $0.dayBp != nil }
        let up = priced.max { ($0.dayBp ?? 0) < ($1.dayBp ?? 0) }
        let down = priced.min { ($0.dayBp ?? 0) < ($1.dayBp ?? 0) }
        if let up, let down, (up.dayBp ?? 0) > 0 || (down.dayBp ?? 0) < 0 {
            HStack(spacing: 8) {
                if (up.dayBp ?? 0) > 0 {
                    Button { open(up.symbol) } label: { moverTile("Top gainer", up) }.buttonStyle(.pressScale)
                }
                if (down.dayBp ?? 0) < 0 {
                    Button { open(down.symbol) } label: { moverTile("Top loser", down) }.buttonStyle(.pressScale)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func moverTile(_ label: String, _ p: Summary.Position) -> some View {
        let bp = p.dayBp ?? 0
        let tint = bp >= 0 ? T.jade : T.coral
        return HStack(spacing: 10) {
            Image(systemName: bp >= 0 ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(Circle().fill(tint.opacity(0.14)))
            VStack(alignment: .leading, spacing: 2) {
                Text(label.uppercased()).font(F.mono(9)).tracking(0.9).foregroundStyle(T.muted)
                HStack(spacing: 6) {
                    Text(p.symbol).font(F.monoSemibold(14)).foregroundStyle(T.paper)
                    Text(bpText(bp)).font(F.mono(11.5)).foregroundStyle(tint)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(11)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(LinearGradient(colors: [tint.opacity(0.1), T.panel.opacity(0.85)], startPoint: .leading, endPoint: .trailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(T.line, lineWidth: 0.75))
        .accessibilityElement(children: .combine)
    }

    private func bpText(_ bp: Int) -> String {
        "\(bp >= 0 ? "+" : "−")\(String(format: "%.2f", Double(abs(bp)) / 100))%"
    }

    private func sectors(_ inv: Summary.Investments, colors: [String: Color]) -> some View {
        let slices = inv.sectors.map { sec in
            MixSlice(id: sec.sector, name: sec.sector, value: sec.cents.dollars, color: colors[sec.sector] ?? T.muted)
        }
        return TitledCard("Allocation", trailing: "\(slices.count) sectors") {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 16) {
                    MixDonut(slices: slices, size: 112)
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(slices) { sl in
                            LegendRow(
                                color: sl.color,
                                name: sl.name,
                                value: inv.valueCents > 0 ? "\(Int((sl.value / inv.valueCents.dollars * 100).rounded()))%" : "—"
                            )
                        }
                    }
                }
                StackedBar(slices: slices, height: 8)
            }
        }
    }

    private func positions(_ s: Summary, colors: [String: Color]) -> some View {
        let total = max(1, s.positions.reduce(0) { $0 + $1.cents })
        let top = Double(s.positions.map(\.cents).max() ?? 1)
        return TitledCard("Positions", trailing: "\(s.positions.count)") {
            VStack(spacing: 0) {
                ForEach(Array(s.positions.enumerated()), id: \.element.symbol) { i, p in
                    let tint = p.sector.flatMap { colors[$0] } ?? T.brass
                    Button { open(p.symbol) } label: {
                    VStack(spacing: 8) {
                        HStack(spacing: 12) {
                            Text(CompanionFormat.ticker(p.symbol))
                                .font(F.monoSemibold(10.5))
                                .foregroundStyle(tint)
                                .frame(width: 46, height: 34)
                                .background(
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .fill(LinearGradient(colors: [tint.opacity(0.2), tint.opacity(0.07)], startPoint: .topLeading, endPoint: .bottomTrailing))
                                )
                                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(tint.opacity(0.25), lineWidth: 0.75))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name ?? p.symbol).font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                                Text([p.qtyLabel.map { p.sector == "Crypto" ? $0 : "\($0) sh" }, p.sector].compactMap { $0 }.joined(separator: " · "))
                                    .font(F.body(11)).foregroundStyle(T.faint).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            VStack(alignment: .trailing, spacing: 3) {
                                Text(p.cents.dollars.money()).font(F.mono(13)).foregroundStyle(T.paper)
                                if let bp = p.dayBp {
                                    Text(bpText(bp))
                                        .font(F.mono(10.5))
                                        .foregroundStyle(bp >= 0 ? T.jade : T.coral)
                                }
                            }
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(T.faint)
                        }
                        HStack(spacing: 8) {
                            SlimMeter(fraction: Double(p.cents) / top, color: tint.opacity(0.8), height: 3)
                            Text(CompanionFormat.percent(Double(p.cents) / Double(total)))
                                .font(F.mono(9.5)).foregroundStyle(T.faint)
                                .frame(width: 30, alignment: .trailing)
                        }
                        .padding(.leading, 58)
                        .padding(.trailing, 19)
                    }
                    .padding(.vertical, 11)
                    .contentShape(Rectangle())
                    }
                    .buttonStyle(.pressScale)
                    .overlay(alignment: .top) { if i > 0 { Hairline() } }
                    .accessibilityElement(children: .combine)
                    .accessibilityHint("Opens the price chart and details")
                }
            }
            .padding(.vertical, -11)
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
            Text(label).font(F.body(11)).foregroundStyle(T.faint)
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
