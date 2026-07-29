// budgetr widgets — the glance app's glance surface.
//
// The RN app publishes a small JSON payload (net worth + spark + budget
// pace) into the shared App Group after every successful sync and reloads
// the timelines; these widgets only ever read that local payload. No
// network, no keys, nothing leaves the device. Amounts are marked
// .privacySensitive() so iOS redacts them on a locked phone.
//
// Seven widgets in the bundle:
//   budgetrGlance        net worth + spark      small / medium / rect / inline
//   budgetrBudgetPace    cumulative vs pace     small / medium (full bleed)
//   budgetrTopCategories ranked category bars   small / medium
//   budgetrCategoryMix   allocation donut       medium
//   budgetrThisWeek      last 7 days + delta    small
//   budgetrMonthGlance   the whole month        large
//   budgetrBudgetLock    budget left            circular / rectangular
//
// Everything after `dayOfMonth` in WidgetPayload is optional: a payload written
// by an older app build simply lacks those keys, and the widgets that need them
// show their empty state instead of a confident zero.

import SwiftUI
import WidgetKit

// ── Payload (written by src/widget.ts; keep the two in sync) ─────────

struct WidgetPayload: Codable {
    var asOf: TimeInterval
    var netWorthCents: Int
    var spark: [Int] // most recent ≤30 daily net-worth values, cents
    var spentCents: Int
    var budgetCents: Int // 0 = no budgets configured
    // Budget pace line (optional: older app writers omit these). budgetCum is
    // cumulative month-to-date spend in cents, one point per elapsed day.
    var budgetCum: [Int]?
    var daysInMonth: Int?
    var dayOfMonth: Int?
    // Category / week / glance widgets. All optional — a payload written by an
    // app build that predates them simply omits the keys, and those widgets
    // fall back to their empty state rather than showing a wrong zero.
    var monthLabel: String?
    var monthSpentCents: Int?
    var priorMonthCents: Int?
    var categories: [CategorySlice]?
    var weekByDay: [Int]? // 7 entries, oldest → today; zeros are real zeros
    var prevWeekCents: Int?
}

/// One spending category this month. Names only — never merchants.
struct CategorySlice: Codable {
    var name: String
    var cents: Int
    var limitCents: Int // 0 = unbudgeted
}

func loadPayload() -> WidgetPayload? {
    guard
        let defaults = UserDefaults(suiteName: "group.dev.budgetr.companion"),
        let raw = defaults.string(forKey: "widgetPayload"),
        let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(WidgetPayload.self, from: data)
}

let placeholderPayload = WidgetPayload(
    asOf: Date().timeIntervalSince1970,
    netWorthCents: 12_345_678,
    spark: [92, 94, 93, 96, 97, 95, 99, 101, 100, 104, 106, 105, 109, 111, 114].map { $0 * 100_000 },
    spentCents: 181_000,
    budgetCents: 250_000,
    budgetCum: [8, 21, 33, 40, 55, 71, 84, 96, 110, 128, 141, 156, 168, 181].map { $0 * 1_000 },
    daysInMonth: 30,
    dayOfMonth: 14,
    monthLabel: "October",
    monthSpentCents: 181_000,
    priorMonthCents: 161_600,
    categories: [
        CategorySlice(name: "Food & Drink", cents: 61_200, limitCents: 70_000),
        CategorySlice(name: "Shopping", cents: 39_400, limitCents: 35_000),
        CategorySlice(name: "Transport", cents: 22_800, limitCents: 30_000),
        CategorySlice(name: "Bills", cents: 20_600, limitCents: 40_000),
        CategorySlice(name: "Entertainment", cents: 18_700, limitCents: 0),
        CategorySlice(name: "Groceries", cents: 18_300, limitCents: 0),
    ],
    weekByDay: [8_200, 14_300, 4_100, 21_000, 9_600, 17_800, 6_400],
    prevWeekCents: 90_200
)

// ── Theme (Private Ledger, hex-matched to the app) ───────────────────

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
    static let ink = Color(hex: 0x080B0A)
    static let panel = Color(hex: 0x131A18)
    static let paper = Color(hex: 0xECE7DA)
    static let mutedInk = Color(hex: 0x8B948C)
    static let jade = Color(hex: 0x6FE3A6)
    static let brass = Color(hex: 0xCBB07C)
    static let coral = Color(hex: 0xF0897B)
    static let hairline = Color(hex: 0x2B3531)
    static let blue = Color(hex: 0x7FB2E0)
    static let lilac = Color(hex: 0xB59CE0)
    static let teal = Color(hex: 0x5FC9C0)

    /// Categorical ramp, by rank — the desktop's PIE_COLORS, reordered so the
    /// biggest slice lands on jade and the runner-up on coral.
    static let pie: [Color] = [.jade, .coral, .blue, .brass, .lilac, .teal]
}

func pieColor(_ i: Int) -> Color { Color.pie[i % Color.pie.count] }

func formatCents(_ cents: Int, compact: Bool = false) -> String {
    let dollars = Double(cents) / 100.0
    if compact, abs(dollars) >= 10_000 {
        return String(format: "$%.1fk", dollars / 1000.0)
    }
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = "USD"
    formatter.maximumFractionDigits = abs(dollars) >= 1000 ? 0 : 2
    return formatter.string(from: NSNumber(value: dollars)) ?? "$0"
}

/// Rounded to the dollar. Widget rows have no room for cents, and "$612.00"
/// reads as noise where "$612" reads as a number.
func formatDollars(_ cents: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = "USD"
    formatter.maximumFractionDigits = 0
    return formatter.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "$0"
}

/// Signed percent change, or nil when there's no baseline to compare against.
func percentDelta(_ now: Int, _ prior: Int) -> Int? {
    guard prior > 0 else { return nil }
    return Int((Double(now - prior) / Double(prior) * 100).rounded())
}

/// "▲ 12% vs last week". Assembled here rather than interpolated inside a
/// Text: a ternary inside string interpolation inside a ViewBuilder is one of
/// the most reliable ways to stall Swift's expression type-checker.
func deltaLabel(_ delta: Int, _ suffix: String) -> String {
    let arrow = delta > 0 ? "▲" : "▼"
    return arrow + " " + String(abs(delta)) + "% " + suffix
}

// ── Timeline ─────────────────────────────────────────────────────────

struct Entry: TimelineEntry {
    let date: Date
    let payload: WidgetPayload?
}

struct Provider: TimelineProvider {
    func placeholder(in _: Context) -> Entry {
        Entry(date: Date(), payload: placeholderPayload)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), payload: context.isPreview ? placeholderPayload : loadPayload() ?? placeholderPayload))
    }

    func getTimeline(in _: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // The app reloads timelines on every sync; this refresh interval is
        // only the fallback for when the app hasn't been opened in a while.
        let entry = Entry(date: Date(), payload: loadPayload())
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// ── Pieces ───────────────────────────────────────────────────────────

struct SparkShape: Shape {
    let values: [Int]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard values.count > 1,
              let lo = values.min(), let hi = values.max()
        else { return path }
        let range = max(1, hi - lo)
        let stepX = rect.width / CGFloat(values.count - 1)
        for (i, v) in values.enumerated() {
            let x = rect.minX + CGFloat(i) * stepX
            let y = rect.maxY - (CGFloat(v - lo) / CGFloat(range)) * rect.height
            if i == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
        }
        return path
    }
}

struct SparkView: View {
    let values: [Int]
    var body: some View {
        let up = (values.last ?? 0) >= (values.first ?? 0)
        SparkShape(values: values)
            .stroke(up ? Color.jade : Color.coral, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
    }
}

struct EyebrowText: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 9, weight: .semibold))
            .kerning(1.4)
            .foregroundStyle(Color.brass)
    }
}

struct StaleNote: View {
    let asOf: TimeInterval
    var body: some View {
        if Date().timeIntervalSince1970 - asOf > 24 * 3600 {
            Text("old data")
                .font(.system(size: 8, weight: .semibold))
                .kerning(0.8)
                .foregroundStyle(Color.brass)
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 4) {
            EyebrowText(text: "budgetr")
            Text("Open the app to sync")
                .font(.system(size: 11))
                .foregroundStyle(Color.mutedInk)
        }
    }
}

// ── Widget views ─────────────────────────────────────────────────────

struct SmallView: View {
    let payload: WidgetPayload
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                EyebrowText(text: "Net worth")
                Spacer()
                StaleNote(asOf: payload.asOf)
            }
            Text(formatCents(payload.netWorthCents, compact: true))
                .font(.system(size: 24, weight: .semibold, design: .serif))
                .foregroundStyle(Color.paper)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .privacySensitive()
            Spacer(minLength: 2)
            SparkView(values: payload.spark)
                .frame(height: 26)
                .privacySensitive()
        }
    }
}

struct MediumView: View {
    let payload: WidgetPayload
    var body: some View {
        let left = payload.budgetCents - payload.spentCents
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    EyebrowText(text: "Net worth")
                    Spacer()
                    StaleNote(asOf: payload.asOf)
                }
                Text(formatCents(payload.netWorthCents))
                    .font(.system(size: 26, weight: .semibold, design: .serif))
                    .foregroundStyle(Color.paper)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .privacySensitive()
                SparkView(values: payload.spark)
                    .frame(height: 24)
                    .privacySensitive()
            }
            if payload.budgetCents > 0 {
                VStack(alignment: .leading, spacing: 4) {
                    EyebrowText(text: left < 0 ? "Over budget" : "Left to spend")
                    Text(formatCents(abs(left), compact: true))
                        .font(.system(size: 20, weight: .semibold, design: .serif))
                        .foregroundStyle(left < 0 ? Color.coral : Color.paper)
                        .privacySensitive()
                    GeometryReader { geo in
                        let pct = payload.budgetCents > 0 ? min(1, Double(payload.spentCents) / Double(payload.budgetCents)) : 1
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.ink)
                            Capsule()
                                .fill(left < 0 ? Color.coral : Color.jade)
                                .frame(width: max(3, geo.size.width * CGFloat(pct)))
                        }
                    }
                    .frame(height: 5)
                    Text("\(formatCents(payload.spentCents, compact: true)) of \(formatCents(payload.budgetCents, compact: true))")
                        .font(.system(size: 10))
                        .foregroundStyle(Color.mutedInk)
                        .privacySensitive()
                }
                .frame(maxWidth: 130)
            }
        }
    }
}

struct LockRectView: View {
    let payload: WidgetPayload
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("NET WORTH")
                .font(.system(size: 10, weight: .semibold))
                .kerning(1.0)
                .opacity(0.7)
            Text(formatCents(payload.netWorthCents))
                .font(.system(size: 18, weight: .semibold, design: .serif))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .privacySensitive()
            SparkView(values: payload.spark)
                .frame(height: 12)
                .opacity(0.9)
                .privacySensitive()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct WidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        Group {
            if let payload = entry.payload {
                switch family {
                case .accessoryInline:
                    Text("◆ \(formatCents(payload.netWorthCents, compact: true))").privacySensitive()
                case .accessoryRectangular:
                    LockRectView(payload: payload)
                case .systemMedium:
                    MediumView(payload: payload)
                default:
                    SmallView(payload: payload)
                }
            } else {
                EmptyStateView()
            }
        }
        .containerBackground(for: .widget) {
            Color.panel
        }
    }
}

// ── Budget pace line graph ───────────────────────────────────────────

/// Full-bleed pace chart. The x-axis spans the days *elapsed* rather than the
/// whole month, so the spend line always runs from the leading edge to the
/// trailing one instead of dying partway across; the dashed guide is the
/// even-pace budget over that same stretch, so "above the dashes = spending too
/// fast" still reads the same. How much month is left is carried by the
/// DAY n/m counter in BudgetPaceSurface.
struct BudgetPaceChart: View {
    let payload: WidgetPayload

    // Headroom at the top so the line's head clears the overlaid readout. The
    // side/bottom insets keep both endpoints inside the widget's ~22pt corner
    // radius — at a true 0/full-width the system clips the stroke away. The
    // gradient underneath still runs to the real edges. Defaults suit the
    // full-bleed surface; MonthGlanceView sits inside margins and zeroes them.
    var topInset: CGFloat = 30
    var bottomInset: CGFloat = 9
    var sideInset: CGFloat = 9

    var body: some View {
        let cum = payload.budgetCum ?? []
        let spent = cum.last ?? 0
        let pace = paceToDate(payload)
        let tint = spent > pace ? Color.coral : Color.jade
        let yMax = Double(max(spent, pace, 1)) * 1.02

        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let bot = h - bottomInset
            let plotW = w - sideInset * 2
            let denom = CGFloat(max(1, cum.count - 1))
            let xFor: (Int) -> CGFloat = { sideInset + CGFloat($0) / denom * plotW }
            let yFor: (Int) -> CGFloat = { bot - (bot - topInset) * CGFloat(Double($0) / yMax) }

            ZStack {
                // even-pace guide for the days elapsed
                Path { p in
                    p.move(to: CGPoint(x: sideInset, y: bot))
                    p.addLine(to: CGPoint(x: w - sideInset, y: yFor(pace)))
                }
                .stroke(Color.mutedInk.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))

                // soft fill beneath the spend line, anchored to the bottom edge
                Path { p in
                    // Runs flat out to the true edges from the inset endpoints,
                    // so the tint bleeds under the corners without a steep wall.
                    p.move(to: CGPoint(x: 0, y: h))
                    p.addLine(to: CGPoint(x: 0, y: yFor(cum.first ?? 0)))
                    for (i, v) in cum.enumerated() { p.addLine(to: CGPoint(x: xFor(i), y: yFor(v))) }
                    p.addLine(to: CGPoint(x: w, y: yFor(spent)))
                    p.addLine(to: CGPoint(x: w, y: h))
                    p.closeSubpath()
                }
                .fill(LinearGradient(
                    colors: [tint.opacity(0.28), tint.opacity(0.02)],
                    startPoint: .top,
                    endPoint: .bottom
                ))

                // cumulative spend to date — jade under pace, coral once ahead
                Path { p in
                    for (i, v) in cum.enumerated() {
                        let pt = CGPoint(x: xFor(i), y: yFor(v))
                        if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
                    }
                }
                .stroke(tint, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

                Circle()
                    .fill(tint)
                    .frame(width: 6, height: 6)
                    .position(x: xFor(cum.count - 1), y: yFor(spent))
            }
        }
    }
}

// Even-pace budget for the days elapsed so far.
private func paceToDate(_ payload: WidgetPayload) -> Int {
    let dim = payload.daysInMonth ?? 30
    let dom = payload.dayOfMonth ?? (payload.budgetCum?.count ?? 0)
    return dim > 0 ? Int(Double(payload.budgetCents) * Double(dom) / Double(dim)) : 0
}

private func hasBudgetPace(_ payload: WidgetPayload) -> Bool {
    payload.budgetCents > 0 && (payload.budgetCum?.count ?? 0) > 1
}

/// One surface: the chart runs corner to corner and the readout sits on top of
/// it, over a scrim that fades out along the diagonal the line climbs.
struct BudgetPaceSurface: View {
    let payload: WidgetPayload
    let compact: Bool // systemSmall

    var body: some View {
        let spent = payload.budgetCum?.last ?? 0
        let ahead = spent > paceToDate(payload)

        BudgetPaceChart(payload: payload)
            .privacySensitive()
            .overlay {
                LinearGradient(
                    colors: [Color.panel.opacity(0.94), Color.panel.opacity(0)],
                    startPoint: .topLeading,
                    endPoint: UnitPoint(x: 0.5, y: 1)
                )
            }
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        EyebrowText(text: "Budget pace")
                        Spacer()
                        StaleNote(asOf: payload.asOf)
                    }
                    Text(formatCents(spent))
                        .font(.system(size: compact ? 22 : 26, weight: .semibold, design: .serif))
                        .foregroundStyle(Color.paper)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .privacySensitive()
                    HStack(spacing: 5) {
                        Text("of \(formatCents(payload.budgetCents))")
                            .font(.system(size: compact ? 9.5 : 10.5))
                            .foregroundStyle(Color.mutedInk)
                            .privacySensitive()
                        if !compact {
                            Text(ahead ? "· ahead of pace" : "· on track")
                                .font(.system(size: 10.5, weight: .medium))
                                .foregroundStyle(ahead ? Color.coral : Color.jade)
                        }
                    }
                }
                .padding(15)
            }
            .overlay(alignment: .bottomTrailing) {
                Text("DAY \(payload.dayOfMonth ?? 0)/\(payload.daysInMonth ?? 30)")
                    .font(.system(size: 8.5, weight: .semibold))
                    .kerning(1.0)
                    .foregroundStyle(Color.mutedInk.opacity(0.85))
                    .padding(.trailing, 13)
                    .padding(.bottom, 11)
            }
    }
}

struct NoBudgetsView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            EyebrowText(text: "Budget pace")
            Spacer()
            Text("No budgets set")
                .font(.system(size: 11))
                .foregroundStyle(Color.mutedInk)
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct BudgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        Group {
            if let payload = entry.payload {
                if hasBudgetPace(payload) {
                    // The chart bleeds to the edges, so it draws its own insets;
                    // the text-only states still need the margins back.
                    BudgetPaceSurface(payload: payload, compact: family != .systemMedium)
                } else {
                    NoBudgetsView().padding(16)
                }
            } else {
                EmptyStateView().padding(16)
            }
        }
        .containerBackground(for: .widget) {
            Color.panel
        }
    }
}

// ── Category widgets ─────────────────────────────────────────────────

/// One "name ————— $amount" row. The bar is share-of-largest, not share-of-
/// budget: at a glance the question is "what dominated the month", and the
/// amount beside it already answers "how much".
struct CategoryRow: View {
    let slice: CategorySlice
    let color: Color
    let largestCents: Int
    let nameSize: CGFloat

    private var fraction: CGFloat { CGFloat(slice.cents) / CGFloat(max(1, largestCents)) }
    private var amount: String { formatDollars(slice.cents) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(slice.name)
                    .font(.system(size: nameSize))
                    .foregroundStyle(Color.paper)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                Text(amount)
                    .font(.system(size: nameSize, design: .monospaced))
                    .foregroundStyle(Color.paper)
                    .privacySensitive()
            }
            GeometryReader { geo in
                let filled: CGFloat = max(4, geo.size.width * fraction)
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.ink)
                    Capsule()
                        .fill(color)
                        .frame(width: filled)
                }
            }
            .frame(height: 4)
        }
    }
}

struct TopCategoriesView: View {
    let payload: WidgetPayload
    let compact: Bool // systemSmall

    private var cats: [CategorySlice] { Array((payload.categories ?? []).prefix(compact ? 3 : 4)) }
    private var largest: Int { cats.map(\.cents).max() ?? 1 }
    private var totalLabel: String { formatDollars(payload.monthSpentCents ?? payload.spentCents) }
    private var footnote: String { "OF " + totalLabel + " THIS MONTH" }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 12 : 9) {
            HStack {
                EyebrowText(text: compact ? "Top spend" : "Top categories")
                Spacer()
                if !compact {
                    Text(totalLabel)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Color.mutedInk)
                        .privacySensitive()
                }
                StaleNote(asOf: payload.asOf)
            }
            ForEach(Array(cats.enumerated()), id: \.offset) { i, c in
                CategoryRow(slice: c, color: pieColor(i), largestCents: largest, nameSize: compact ? 11 : 12)
            }
            if compact {
                Spacer(minLength: 0)
                Text(footnote)
                    .font(.system(size: 8, weight: .semibold))
                    .kerning(0.8)
                    .foregroundStyle(Color.mutedInk)
                    .privacySensitive()
            }
        }
    }
}

/// One ring segment, fully resolved before it reaches a ViewBuilder.
private struct Arc: Identifiable {
    let id: Int
    let start: Angle
    let end: Angle
    let color: Color
}

/// Allocation ring, hand-drawn — WidgetKit can't use the app's SVG donut.
///
/// The angles are computed in plain Swift rather than inline in the ForEach.
/// Chained implicit-member Double literals (`.pi * -0.5 + .pi * 2 * …`) inside
/// a ViewBuilder overwhelm the expression type-checker's time budget, and that
/// budget scales with machine speed: it type-checks fine on a fast laptop and
/// fails the build on an EAS worker.
struct DonutView: View {
    let slices: [CategorySlice]

    private var arcs: [Arc] {
        let total = Double(max(1, slices.reduce(0) { $0 + $1.cents }))
        let quarterTurn: Double = -Double.pi / 2 // start at 12 o'clock
        var running: Double = 0
        var out: [Arc] = []
        for (i, slice) in slices.enumerated() {
            let start = running
            running += Double(slice.cents) / total * 2 * Double.pi
            out.append(Arc(
                id: i,
                start: Angle(radians: quarterTurn + start),
                end: Angle(radians: quarterTurn + running),
                color: pieColor(i)
            ))
        }
        return out
    }

    var body: some View {
        GeometryReader { geo in
            let radius = min(geo.size.width, geo.size.height) / 2
            let inner = radius * 0.62
            let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            ZStack {
                ForEach(arcs) { arc in
                    Path { p in
                        p.addArc(center: center, radius: radius, startAngle: arc.start, endAngle: arc.end, clockwise: false)
                        p.addArc(center: center, radius: inner, startAngle: arc.end, endAngle: arc.start, clockwise: true)
                        p.closeSubpath()
                    }
                    .fill(arc.color)
                }
            }
        }
    }
}

struct CategoryMixView: View {
    let payload: WidgetPayload

    private var cats: [CategorySlice] { Array((payload.categories ?? []).prefix(6)) }
    private var totalLabel: String { formatDollars(payload.monthSpentCents ?? payload.spentCents) }

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                DonutView(slices: cats)
                VStack(spacing: 1) {
                    Text(totalLabel)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color.paper)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                        .privacySensitive()
                    Text("MONTH")
                        .font(.system(size: 7, weight: .semibold))
                        .kerning(1)
                        .foregroundStyle(Color.mutedInk)
                }
            }
            .frame(width: 92, height: 92)

            VStack(alignment: .leading, spacing: 3) {
                EyebrowText(text: "Where it went")
                ForEach(Array(cats.enumerated()), id: \.offset) { i, c in
                    HStack(spacing: 7) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(pieColor(i))
                            .frame(width: 8, height: 8)
                        Text(c.name)
                            .font(.system(size: 10.5))
                            .foregroundStyle(Color.mutedInk)
                            .lineLimit(1)
                        Spacer(minLength: 2)
                        Text(formatDollars(c.cents))
                            .font(.system(size: 10.5, design: .monospaced))
                            .foregroundStyle(Color.paper)
                            .privacySensitive()
                    }
                }
            }
        }
    }
}

// ── This week ────────────────────────────────────────────────────────

/// One day's column, resolved before it reaches the ViewBuilder.
private struct WeekBar: Identifiable {
    let id: Int
    let label: String
    let fraction: CGFloat
    let isToday: Bool
}

struct ThisWeekView: View {
    let payload: WidgetPayload

    private var total: Int { (payload.weekByDay ?? []).reduce(0, +) }
    private var delta: Int? { percentDelta(total, payload.prevWeekCents ?? 0) }

    /// Weekday initials ending on today, so the last bar is always "now".
    /// Built in plain Swift: the index wrap-around and the height ratio are
    /// exactly the kind of literal arithmetic that stalls the type-checker
    /// when written inline in a ForEach.
    private var bars: [WeekBar] {
        let week = payload.weekByDay ?? []
        let peak = CGFloat(max(1, week.max() ?? 1))
        let symbols = Calendar.current.veryShortWeekdaySymbols
        let todayIndex = Calendar.current.component(.weekday, from: Date()) - 1
        var out: [WeekBar] = []
        for (i, cents) in week.enumerated() {
            let daysAgo = week.count - 1 - i
            var symbolIndex = (todayIndex - daysAgo) % 7
            if symbolIndex < 0 { symbolIndex += 7 }
            out.append(WeekBar(
                id: i,
                label: symbols.indices.contains(symbolIndex) ? symbols[symbolIndex] : "",
                fraction: CGFloat(cents) / peak,
                isToday: daysAgo == 0
            ))
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                EyebrowText(text: "This week")
                Spacer()
                StaleNote(asOf: payload.asOf)
            }
            Text(formatDollars(total))
                .font(.system(size: 24, weight: .semibold, design: .serif))
                .foregroundStyle(Color.paper)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .privacySensitive()
            if let d = delta {
                Text(deltaLabel(d, "vs last week"))
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(d > 0 ? Color.coral : Color.jade)
            } else {
                Text("no week to compare yet")
                    .font(.system(size: 9.5))
                    .foregroundStyle(Color.mutedInk)
            }
            Spacer(minLength: 4)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(bars) { bar in
                    VStack(spacing: 4) {
                        Spacer(minLength: 0)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(bar.isToday ? Color.paper : Color.brass)
                            .frame(height: max(3, 44 * bar.fraction))
                            .opacity(0.9)
                        Text(bar.label)
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(Color.mutedInk)
                    }
                }
            }
            .frame(height: 60)
            .privacySensitive()
        }
    }
}

// ── Month at a glance (systemLarge) ──────────────────────────────────

struct MonthGlanceView: View {
    let payload: WidgetPayload

    private var spent: Int { payload.monthSpentCents ?? payload.spentCents }
    private var delta: Int? { percentDelta(spent, payload.priorMonthCents ?? 0) }
    private var cats: [CategorySlice] { Array((payload.categories ?? []).prefix(4)) }
    private var largest: Int { cats.map(\.cents).max() ?? 1 }

    private var headline: String {
        let month = payload.monthLabel ?? "This month"
        let dom = payload.dayOfMonth ?? 0
        let dim = payload.daysInMonth ?? 30
        return month + " · day " + String(dom) + " of " + String(dim)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                EyebrowText(text: headline)
                Spacer()
                StaleNote(asOf: payload.asOf)
            }
            Text(formatDollars(spent))
                .font(.system(size: 34, weight: .semibold, design: .serif))
                .foregroundStyle(Color.paper)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .padding(.top, 6)
                .privacySensitive()
            if let d = delta {
                Text(deltaLabel(d, "vs this day last month"))
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(d > 0 ? Color.coral : Color.jade)
            }

            if hasBudgetPace(payload) {
                BudgetPaceChart(payload: payload, topInset: 8, bottomInset: 3, sideInset: 0)
                    .frame(height: 88)
                    .padding(.top, 10)
                    .privacySensitive()
            }

            Divider().overlay(Color.hairline).padding(.vertical, 12)

            EyebrowText(text: "Top categories")
            VStack(spacing: 9) {
                ForEach(Array(cats.enumerated()), id: \.offset) { i, c in
                    CategoryRow(slice: c, color: pieColor(i), largestCents: largest, nameSize: 12)
                }
            }
            .padding(.top, 8)
            Spacer(minLength: 0)
        }
    }
}

// ── Lock Screen ──────────────────────────────────────────────────────

/// accessoryCircular: how much of the month's budget is gone. Accessory
/// families render monochrome/tinted, so this deliberately uses no brand color.
struct BudgetRingView: View {
    let payload: WidgetPayload

    private var fraction: Double {
        guard payload.budgetCents > 0 else { return 0 }
        let spent = Double(payload.monthSpentCents ?? payload.spentCents)
        return min(1.0, spent / Double(payload.budgetCents))
    }

    private var percentLabel: String { String(Int((fraction * 100).rounded())) }

    var body: some View {
        Gauge(value: fraction) {
            Text("BUDGET")
        } currentValueLabel: {
            Text(percentLabel).privacySensitive()
        }
        .gaugeStyle(.accessoryCircularCapacity)
    }
}

/// accessoryRectangular: what's left, and whether the month is running hot.
struct BudgetLeftView: View {
    let payload: WidgetPayload

    private var spent: Int { payload.monthSpentCents ?? payload.spentCents }
    private var left: Int { payload.budgetCents - spent }
    private var title: String { left < 0 ? "OVER BUDGET" : "LEFT TO SPEND" }
    private var amount: String { formatDollars(abs(left)) }

    private var fraction: CGFloat {
        guard payload.budgetCents > 0 else { return 0 }
        return CGFloat(min(1.0, Double(spent) / Double(payload.budgetCents)))
    }

    private var footer: String {
        let dom = payload.dayOfMonth ?? 0
        let dim = payload.daysInMonth ?? 30
        let pace = spent > paceToDate(payload) ? "ahead of pace" : "on track"
        return "day " + String(dom) + "/" + String(dim) + " · " + pace
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 10, weight: .semibold))
                .kerning(1.0)
                .opacity(0.7)
            Text(amount)
                .font(.system(size: 19, weight: .semibold, design: .serif))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .privacySensitive()
            // Hand-drawn rather than a ProgressView: accessory families flatten
            // to the Lock Screen's tint, and a bare capsule pair survives that
            // reliably where a styled control picks up a system accent.
            GeometryReader { geo in
                let filled: CGFloat = max(3, geo.size.width * fraction)
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.25))
                    Capsule().frame(width: filled)
                }
            }
            .frame(height: 4)
            .padding(.vertical, 1)
            .privacySensitive()
            Text(footer)
                .font(.system(size: 9))
                .opacity(0.65)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// ── Entry views for the new widgets ──────────────────────────────────

private func hasCategories(_ p: WidgetPayload) -> Bool { !(p.categories ?? []).isEmpty }

/// Shared chrome: panel background, and a text-only fallback whenever the
/// payload can't answer the question this widget asks.
struct PanelWidget<Content: View>: View {
    let ready: Bool
    let empty: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        Group {
            if ready {
                content()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    EyebrowText(text: "budgetr")
                    Text(empty)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.mutedInk)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .containerBackground(for: .widget) { Color.panel }
    }
}

struct TopCategoriesEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        let p = entry.payload
        PanelWidget(ready: p != nil && hasCategories(p!), empty: "Open the app to sync") {
            TopCategoriesView(payload: p ?? placeholderPayload, compact: family != .systemMedium)
        }
    }
}

struct CategoryMixEntryView: View {
    let entry: Entry

    var body: some View {
        let p = entry.payload
        PanelWidget(ready: p != nil && hasCategories(p!), empty: "Open the app to sync") {
            CategoryMixView(payload: p ?? placeholderPayload)
        }
    }
}

struct ThisWeekEntryView: View {
    let entry: Entry

    var body: some View {
        let p = entry.payload
        PanelWidget(ready: (p?.weekByDay?.count ?? 0) == 7, empty: "Open the app to sync") {
            ThisWeekView(payload: p ?? placeholderPayload)
        }
    }
}

struct MonthGlanceEntryView: View {
    let entry: Entry

    var body: some View {
        let p = entry.payload
        PanelWidget(ready: p != nil, empty: "Open the app to sync") {
            MonthGlanceView(payload: p ?? placeholderPayload)
        }
    }
}

struct BudgetLockEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        let p = entry.payload ?? placeholderPayload
        Group {
            if family == .accessoryCircular {
                BudgetRingView(payload: p)
            } else {
                BudgetLeftView(payload: p)
            }
        }
        .containerBackground(for: .widget) { Color.clear }
    }
}

// ── Bundle ───────────────────────────────────────────────────────────

struct BudgetrWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "budgetrGlance", provider: Provider()) { entry in
            WidgetEntryView(entry: entry)
        }
        .configurationDisplayName("budgetr")
        .description("Net worth and budget pace, end-to-end encrypted from your Mac.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

struct BudgetPaceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "budgetrBudgetPace", provider: Provider()) { entry in
            BudgetEntryView(entry: entry)
        }
        .configurationDisplayName("budgetr — Budget")
        .description("Month-to-date spending against an even-pace line, end-to-end encrypted from your Mac.")
        .supportedFamilies([.systemSmall, .systemMedium])
        // Let the chart reach the widget's rounded corners. Only this widget —
        // BudgetrWidget still wants the system's default content margins.
        .contentMarginsDisabled()
    }
}

struct TopCategoriesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "budgetrTopCategories", provider: Provider()) { entry in
            TopCategoriesEntryView(entry: entry)
        }
        .configurationDisplayName("budgetr — Categories")
        .description("What you spent the most on this month, ranked.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct CategoryMixWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "budgetrCategoryMix", provider: Provider()) { entry in
            CategoryMixEntryView(entry: entry)
        }
        .configurationDisplayName("budgetr — Mix")
        .description("This month's spending split by category.")
        .supportedFamilies([.systemMedium])
    }
}

struct ThisWeekWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "budgetrThisWeek", provider: Provider()) { entry in
            ThisWeekEntryView(entry: entry)
        }
        .configurationDisplayName("budgetr — This week")
        .description("The last seven days of spending, against the week before.")
        .supportedFamilies([.systemSmall])
    }
}

struct MonthGlanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "budgetrMonthGlance", provider: Provider()) { entry in
            MonthGlanceEntryView(entry: entry)
        }
        .configurationDisplayName("budgetr — Month")
        .description("The whole month: total, pace, and where it went.")
        .supportedFamilies([.systemLarge])
    }
}

struct BudgetLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "budgetrBudgetLock", provider: Provider()) { entry in
            BudgetLockEntryView(entry: entry)
        }
        .configurationDisplayName("budgetr — Budget left")
        .description("How much of the month's budget is left, on the Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}

@main
struct BudgetrWidgets: WidgetBundle {
    var body: some Widget {
        BudgetrWidget()
        BudgetPaceWidget()
        TopCategoriesWidget()
        CategoryMixWidget()
        ThisWeekWidget()
        MonthGlanceWidget()
        BudgetLockWidget()
    }
}
