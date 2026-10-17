import SwiftUI

// One holding, opened from Holdings: its price over a chosen range (scrub it,
// and the headline price follows your finger), what you hold and how it has
// done, and where today's price sits in its day and year. The position numbers
// are the Mac's, from the Summary; the price history is fetched for this
// ticker alone (see MarketData).

struct PositionDetailView: View {
    let position: Summary.Position
    let summary: Summary

    @State private var range: MarketData.Range = .month
    @State private var series: MarketData.Series?
    @State private var failure: MarketData.Failure?
    @State private var loading = false
    @State private var active: Int?

    private var quantity: Double? {
        position.qtyLabel.flatMap { Double($0.filter { "0123456789.-".contains($0) }) }
    }

    /// The Mac's value over its quantity — the price when the chart can't load.
    private var impliedPrice: Double? {
        guard let q = quantity, q != 0 else { return nil }
        return position.cents.dollars / q
    }

    private var portfolioTotal: Int {
        summary.investments?.valueCents ?? summary.positions.reduce(0) { $0 + $1.cents }
    }

    var body: some View {
        BScreen(position.symbol, eyebrow: [position.sector, series?.exchange].compactMap { $0 }.joined(separator: " · ").ifEmpty("Position")) {
            priceHeader.rise(0)
            chartCard.rise(1)
            holdingCard.rise(2)
            if let series { marketCard(series).rise(3) }
            footnote.rise(4)
        }
        .task(id: range) { await load() }
        .refreshable { await load(force: true) }
    }

    // ── Price ────────────────────────────────────────────────────────

    private var priceHeader: some View {
        let points = series?.points ?? []
        let scrubbed = active.flatMap { points.indices.contains($0) ? points[$0] : nil }
        let price = scrubbed?.close ?? series?.price ?? impliedPrice
        let base = series?.previousClose ?? points.first?.close
        let change: Double? = {
            if let s = scrubbed, let base, base > 0 { return (s.close - base) / base }
            return series?.change
        }()
        let up = (change ?? 0) >= 0

        return VStack(alignment: .leading, spacing: 8) {
            Text(series?.name ?? position.name ?? position.symbol)
                .font(F.medium(14))
                .foregroundStyle(T.muted)
                .lineLimit(1)
            Text(price.map(priceText) ?? "—")
                .font(F.display(44))
                .tracking(-1)
                .foregroundStyle(T.paper)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .contentTransition(.numericText(value: price ?? 0))
                .animation(active == nil ? M.snappy : nil, value: price)
            HStack(spacing: 8) {
                if let change, let base, let price {
                    DeltaPill(pct: change * 100, upIsGood: true)
                    Text("\(up ? "+" : "−")\(priceText(abs(price - base)))")
                        .font(F.mono(12))
                        .foregroundStyle(up ? T.jade : T.coral)
                }
                Text(scrubbed.map { stamp($0.date) } ?? rangeLabel)
                    .font(F.body(12))
                    .foregroundStyle(T.faint)
                    .contentTransition(.opacity)
            }
            .frame(height: 22)
        }
        .heroGlow(up ? T.jade : T.coral)
    }

    private var rangeLabel: String {
        switch range {
        case .day: return "today"
        case .week: return "past week"
        case .month: return "past month"
        case .quarter: return "past 3 months"
        case .year: return "past year"
        case .fiveYears: return "past 5 years"
        }
    }

    private func stamp(_ d: Date) -> String {
        range.intraday
            ? d.formatted(.dateTime.weekday(.abbreviated).hour().minute())
            : d.formatted(.dateTime.month(.abbreviated).day().year())
    }

    private func priceText(_ v: Double) -> String {
        // Sub-dollar prices (some crypto) need the extra digits to move at all.
        if abs(v) < 1 && v != 0 { return v.formatted(.currency(code: series?.currency ?? "USD").precision(.fractionLength(4))) }
        return v.money(series?.currency ?? "USD")
    }

    // ── Chart ────────────────────────────────────────────────────────

    private var chartCard: some View {
        Card(padding: 14) {
            VStack(spacing: 14) {
                ZStack {
                    if let series, !series.points.isEmpty {
                        PriceChart(
                            points: series.points,
                            baseline: series.previousClose,
                            active: $active,
                            height: 190
                        )
                        .id("\(series.symbol)-\(range.rawValue)")
                        .transition(.opacity)
                        .opacity(loading ? 0.45 : 1)
                    } else if let failure, !loading {
                        VStack(spacing: 10) {
                            Image(systemName: failure == .offline ? "wifi.slash" : "chart.line.downtrend.xyaxis")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundStyle(T.faint)
                            Text(failure == .offline ? "Couldn't reach the price feed." : "No price history for \(position.symbol).")
                                .font(F.body(12.5)).foregroundStyle(T.muted)
                            if failure == .offline {
                                Button {
                                    Haptics.tap()
                                    Task { await load(force: true) }
                                } label: {
                                    Text("Try again").font(F.semibold(12.5)).foregroundStyle(T.brass)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    } else {
                        ChartSkeleton()
                    }
                }
                .frame(height: 214)
                .animation(M.settle, value: series?.points.count)

                Segmented(
                    options: MarketData.Range.allCases.map { ($0.rawValue, $0) },
                    selection: $range
                )
            }
        }
    }

    // ── Holding ──────────────────────────────────────────────────────

    private var holdingCard: some View {
        let value = position.cents
        let pnl = position.pnlCents
        let cost = pnl.map { value - $0 }
        let returnPct: Double? = {
            guard let pnl, let cost, cost != 0 else { return nil }
            return Double(pnl) / Double(abs(cost)) * 100
        }()
        // Today's move in dollars, backed out of the Mac's basis points.
        let today: Double? = position.dayBp.map { bp in
            let r = Double(bp) / 10_000
            return value.dollars - value.dollars / (1 + r)
        }
        let weight = portfolioTotal > 0 ? Double(value) / Double(portfolioTotal) : 0

        return TitledCard("Your position", trailing: "from your Mac") {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .center, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("MARKET VALUE").font(F.mono(9.5)).tracking(0.9).foregroundStyle(T.muted)
                        AnimatedMoney(value: value.dollars, font: F.display(30))
                        if let pnl, let returnPct {
                            HStack(spacing: 6) {
                                DeltaPill(pct: returnPct, upIsGood: true, size: 10.5)
                                Text("\(pnl >= 0 ? "+" : "−")\(abs(pnl).dollars.money()) all time")
                                    .font(F.mono(11))
                                    .foregroundStyle(pnl >= 0 ? T.jade : T.coral)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    RingGauge(fraction: weight, color: T.blue, lineWidth: 7) {
                        VStack(spacing: 0) {
                            Text(CompanionFormat.percent(weight)).font(F.monoSemibold(13)).foregroundStyle(T.paper)
                            Text("of portfolio").font(F.body(8)).foregroundStyle(T.faint)
                        }
                    }
                    .frame(width: 74, height: 74)
                }

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    StatTile(label: "Quantity", value: position.qtyLabel ?? "—", note: quantityNote)
                    StatTile(
                        label: "Today",
                        value: today.map { "\($0 >= 0 ? "+" : "−")\(abs($0).moneyCompact())" } ?? "—",
                        tint: (today ?? 0) >= 0 ? T.jade : T.coral,
                        note: position.dayBp.map { bp in "\(bp >= 0 ? "+" : "−")\(String(format: "%.2f", Double(abs(bp)) / 100))%" }
                    )
                    StatTile(label: "Cost basis", value: cost.map { $0.dollars.moneyCompact() } ?? "—", note: "total paid")
                    StatTile(
                        label: "Avg cost",
                        value: avgCost(cost).map(priceText) ?? "—",
                        note: avgCostNote(cost)
                    )
                }
            }
        }
    }

    private var quantityNote: String {
        switch series?.kind {
        case "CRYPTOCURRENCY": return "coins"
        case "ETF", "MUTUALFUND": return "shares · fund"
        default: return "shares"
        }
    }

    private func avgCost(_ cost: Int?) -> Double? {
        guard let cost, let q = quantity, q != 0 else { return nil }
        return cost.dollars / q
    }

    /// How far today's price is from what was paid, per share.
    private func avgCostNote(_ cost: Int?) -> String {
        guard let avg = avgCost(cost), avg > 0, let price = series?.price ?? impliedPrice else { return "per share" }
        let pct = (price - avg) / avg * 100
        return "\(pct >= 0 ? "+" : "−")\(Int(abs(pct).rounded()))% vs now"
    }

    // ── Market ───────────────────────────────────────────────────────

    private func marketCard(_ s: MarketData.Series) -> some View {
        let price = s.price ?? s.points.last?.close ?? 0
        return TitledCard("Market", trailing: s.currency) {
            VStack(alignment: .leading, spacing: 18) {
                if let lo = s.dayLow, let hi = s.dayHigh, hi > 0 {
                    RangeBar(label: "Day range", low: lo, high: hi, value: price, format: priceText)
                }
                if let lo = s.yearLow, let hi = s.yearHigh, hi > 0 {
                    RangeBar(label: "52-week range", low: lo, high: hi, value: price, format: priceText)
                }
                VStack(spacing: 0) {
                    if let prev = s.previousClose {
                        infoRow("Previous close", priceText(prev))
                    }
                    if let v = s.volume, v > 0 { infoRow("Volume", compactNumber(v)) }
                    if let hi = s.yearHigh, hi > 0 {
                        infoRow("Off 52-week high", "\(Int(((hi - price) / hi * 100).rounded()))%")
                    }
                    if let ex = s.exchange { infoRow("Exchange", ex) }
                    if let kind = s.kind { infoRow("Type", kindLabel(kind), last: true) }
                }
            }
        }
    }

    private func infoRow(_ label: String, _ value: String, last: Bool = false) -> some View {
        HStack {
            Text(label).font(F.body(13)).foregroundStyle(T.muted)
            Spacer()
            Text(value).font(F.mono(12.5)).foregroundStyle(T.paper).lineLimit(1)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { if !last { Hairline() } }
    }

    private func kindLabel(_ raw: String) -> String {
        switch raw {
        case "EQUITY": return "Stock"
        case "ETF": return "ETF"
        case "MUTUALFUND": return "Mutual fund"
        case "CRYPTOCURRENCY": return "Crypto"
        case "INDEX": return "Index"
        default: return raw.capitalized
        }
    }

    private func compactNumber(_ v: Double) -> String {
        if v >= 1_000_000_000 { return String(format: "%.2fB", v / 1_000_000_000) }
        if v >= 1_000_000 { return String(format: "%.1fM", v / 1_000_000) }
        if v >= 1_000 { return String(format: "%.1fK", v / 1_000) }
        return String(Int(v))
    }

    private var footnote: some View {
        VStack(spacing: 4) {
            Text("Prices from Yahoo Finance and may be delayed\(series.map { " · \($0.fetchedAt.formatted(.dateTime.hour().minute()))" } ?? "").")
            Text("Holding figures are your Mac's, as of \(CompanionFormat.ago(Date(timeIntervalSince1970: TimeInterval(summary.asOf)))).")
        }
        .font(F.body(11))
        .foregroundStyle(T.faint)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }

    // ── Loading ──────────────────────────────────────────────────────

    private func load(force: Bool = false) async {
        loading = true
        active = nil
        defer { loading = false }
        do {
            let s = try await MarketData.shared.series(position.symbol, range: range)
            withAnimation(M.settle) {
                series = s
                failure = nil
            }
        } catch let f as MarketData.Failure {
            // Keep the last good chart on screen if there is one.
            if series == nil || series?.symbol != position.symbol { failure = f }
            else if force { Haptics.warning() }
        } catch {
            failure = .unreadable
        }
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

/// Bars of nothing, sweeping — the chart is on its way.
private struct ChartSkeleton: View {
    var body: some View {
        GeometryReader { geo in
            Path { p in
                let w = geo.size.width, h = geo.size.height
                p.move(to: CGPoint(x: 0, y: h * 0.7))
                for i in 1...24 {
                    let x = w * CGFloat(i) / 24
                    let y = h * (0.5 + 0.22 * sin(CGFloat(i) * 0.7) - 0.15 * CGFloat(i) / 24)
                    p.addLine(to: CGPoint(x: x, y: y))
                }
            }
            .stroke(T.panel2, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
        }
        .shimmer()
        .accessibilityLabel("Loading prices")
    }
}

// ── Price chart ──────────────────────────────────────────────────────

/// A price line you can scrub. Jade when the range ends up, coral when down;
/// a dashed baseline at the prior close on 1D; the high and low marked while
/// you're not touching it. The selection is a binding so the page's headline
/// price can follow your finger.
struct PriceChart: View {
    let points: [MarketData.Point]
    var baseline: Double?
    @Binding var active: Int?
    var height: CGFloat = 190

    @State private var drawn: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var values: [Double] { points.map(\.close) }
    private var up: Bool { (values.last ?? 0) >= (baseline ?? values.first ?? 0) }
    private var color: Color { up ? T.jade : T.coral }

    private var bounds: (lo: Double, hi: Double) {
        var lo = values.min() ?? 0, hi = values.max() ?? 1
        if let baseline { lo = min(lo, baseline); hi = max(hi, baseline) }
        let pad = max((hi - lo) * 0.08, hi * 0.001)
        return (lo - pad, hi + pad)
    }

    var body: some View {
        GeometryReader { geo in
            let size = CGSize(width: geo.size.width, height: height)
            let b = bounds
            let pt: (Int) -> CGPoint = { i in
                let x = values.count > 1 ? CGFloat(i) / CGFloat(values.count - 1) * size.width : size.width / 2
                let y = (1 - CGFloat((values[i] - b.lo) / max(b.hi - b.lo, 0.0001))) * size.height
                return CGPoint(x: x, y: y)
            }

            ZStack(alignment: .topLeading) {
                // Faint horizontal guides, so the line has a floor to sit on.
                ForEach(1..<4, id: \.self) { i in
                    Rectangle().fill(T.line.opacity(0.5)).frame(height: 0.5)
                        .offset(y: size.height * CGFloat(i) / 4)
                }

                if let baseline {
                    let y = (1 - CGFloat((baseline - b.lo) / max(b.hi - b.lo, 0.0001))) * size.height
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: y))
                        p.addLine(to: CGPoint(x: size.width, y: y))
                    }
                    .stroke(T.muted.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
                }

                Path { p in
                    guard values.count > 1 else { return }
                    p.move(to: CGPoint(x: 0, y: size.height))
                    for i in values.indices { p.addLine(to: pt(i)) }
                    p.addLine(to: CGPoint(x: size.width, y: size.height))
                    p.closeSubpath()
                }
                .fill(LinearGradient(colors: [color.opacity(0.26), color.opacity(0)], startPoint: .top, endPoint: .bottom))
                .opacity(Double(drawn))

                Path { p in
                    guard values.count > 1 else { return }
                    p.move(to: pt(0))
                    for i in 1..<values.count { p.addLine(to: pt(i)) }
                }
                .trim(from: 0, to: drawn)
                .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .shadow(color: color.opacity(0.4), radius: 6, y: 2)

                if active == nil && drawn >= 1 && values.count > 2 {
                    extreme(pt, values.indices.max { values[$0] < values[$1] }, above: true, width: size.width)
                    extreme(pt, values.indices.min { values[$0] < values[$1] }, above: false, width: size.width)
                    Circle()
                        .fill(color)
                        .overlay(Circle().strokeBorder(T.panel, lineWidth: 2))
                        .frame(width: 9, height: 9)
                        .position(pt(values.count - 1))
                }

                if let i = active, values.indices.contains(i) {
                    let p = pt(i)
                    Rectangle().fill(T.paper.opacity(0.5)).frame(width: 1, height: size.height)
                        .offset(x: p.x)
                    Circle()
                        .fill(color)
                        .overlay(Circle().strokeBorder(T.paper, lineWidth: 2))
                        .frame(width: 12, height: 12)
                        .position(p)
                }
            }
            .frame(width: size.width, height: size.height)
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        if abs(v.translation.height) > 16 && abs(v.translation.height) > abs(v.translation.width) {
                            if active != nil { active = nil }
                            return
                        }
                        guard size.width > 0, values.count > 1 else { return }
                        let i = max(0, min(values.count - 1, Int((v.location.x / size.width * CGFloat(values.count - 1)).rounded())))
                        if i != active {
                            Haptics.tick()
                            active = i
                        }
                    }
                    .onEnded { _ in withAnimation(.easeOut(duration: 0.2)) { active = nil } }
            )
        }
        .frame(height: height)
        .padding(.vertical, 12)
        .onAppear {
            if reduceMotion { drawn = 1 } else { withAnimation(.easeOut(duration: 0.75)) { drawn = 1 } }
        }
        .accessibilityElement()
        .accessibilityLabel("Price chart")
        .accessibilityValue("from \(values.first?.money() ?? "") to \(values.last?.money() ?? ""), \(up ? "up" : "down")")
    }

    @ViewBuilder
    private func extreme(_ pt: (Int) -> CGPoint, _ index: Int?, above: Bool, width: CGFloat) -> some View {
        if let index {
            let p = pt(index)
            Text(values[index].money())
                .font(F.mono(9.5))
                .foregroundStyle(T.muted)
                .fixedSize()
                .position(x: min(max(30, p.x), width - 30), y: p.y + (above ? -10 : 10))
        }
    }
}
