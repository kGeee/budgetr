// budgetr widgets — the glance app's glance surface.
//
// The RN app publishes a small JSON payload (net worth + spark + budget
// pace) into the shared App Group after every successful sync and reloads
// the timelines; these widgets only ever read that local payload. No
// network, no keys, nothing leaves the device. Amounts are marked
// .privacySensitive() so iOS redacts them on a locked phone.
//
// Families: systemSmall (net worth + spark), systemMedium (adds budget
// pace), accessoryRectangular + accessoryInline (Lock Screen).

import SwiftUI
import WidgetKit

// ── Payload (written by src/widget.ts; keep the two in sync) ─────────

struct WidgetPayload: Codable {
    var asOf: TimeInterval
    var netWorthCents: Int
    var spark: [Int] // most recent ≤30 daily net-worth values, cents
    var spentCents: Int
    var budgetCents: Int // 0 = no budgets configured
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
    spentCents: 187_500,
    budgetCents: 250_000
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
}

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

@main
struct BudgetrWidgets: WidgetBundle {
    var body: some Widget {
        BudgetrWidget()
    }
}
