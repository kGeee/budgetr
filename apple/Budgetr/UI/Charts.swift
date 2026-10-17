import Charts
import SwiftUI

// The companion's hand-drawn charts (bits.tsx: Bars, PaceLine, Donut,
// MiniBars), natively. Drawn by hand rather than with Swift Charts' defaults
// because the grammar is the point: no axes to read, a floating readout under
// your finger, and a haptic detent each time it crosses onto a new day.

/// One bar: a day and what was spent on it.
struct BarPoint: Identifiable, Equatable {
    let id: String
    let date: Date
    let value: Double
}

/// Daily spend, scrubbable. Brass bars; the one under your finger lights ivory
/// with a money + date readout above it, and the rest dim back.
struct ScrubBars: View {
    let points: [BarPoint]
    var height: CGFloat = 104
    var color: Color = T.brass

    @State private var active: Int?
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let readoutHeight: CGFloat = 24

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let n = max(points.count, 1)
            let slot = w / CGFloat(n)
            let barW = max(2, slot * 0.62)
            let maxV = max(1, points.map(\.value).max() ?? 1)

            ZStack(alignment: .topLeading) {
                if let i = active, points.indices.contains(i) {
                    readout(points[i])
                        .position(x: min(max(48, CGFloat(i) * slot + slot / 2), w - 48), y: readoutHeight / 2 - 2)
                }

                ZStack(alignment: .bottomLeading) {
                    ForEach(Array(points.enumerated()), id: \.element.id) { i, p in
                        let h = max(2, CGFloat(p.value / maxV) * (height - 6))
                        RoundedRectangle(cornerRadius: min(2, barW / 2), style: .continuous)
                            .fill(active == i ? T.paper : color)
                            .opacity(active == nil || active == i ? 0.92 : 0.4)
                            .frame(width: barW, height: grown ? h : 2)
                            .offset(x: CGFloat(i) * slot + (slot - barW) / 2)
                    }
                }
                .frame(width: w, height: height, alignment: .bottomLeading)
                .offset(y: readoutHeight)
            }
            .contentShape(Rectangle())
            // Simultaneous, so a page scroll that starts on the chart still
            // scrolls; a drag that turns out to be vertical drops the readout.
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        if abs(v.translation.height) > 14 && abs(v.translation.height) > abs(v.translation.width) {
                            if active != nil { active = nil }
                        } else {
                            pick(v.location.x, slot: slot)
                        }
                    }
                    .onEnded { _ in
                        withAnimation(.easeOut(duration: 0.18)) { active = nil }
                    }
            )
        }
        .frame(height: height + readoutHeight)
        .onAppear {
            if reduceMotion { grown = true } else { withAnimation(M.settle.delay(0.1)) { grown = true } }
        }
        .accessibilityElement()
        .accessibilityLabel("Daily spending")
        .accessibilityValue(accessibilitySummary)
    }

    private func pick(_ x: CGFloat, slot: CGFloat) {
        guard slot > 0, !points.isEmpty else { return }
        let i = max(0, min(points.count - 1, Int(x / slot)))
        if i != active {
            Haptics.tick()
            active = i
        }
    }

    private func readout(_ p: BarPoint) -> some View {
        VStack(spacing: 0) {
            Text(p.value.money()).font(F.monoSemibold(12.5)).foregroundStyle(T.paper)
            Text(p.date.formatted(.dateTime.month(.abbreviated).day()))
                .font(F.body(9.5))
                .foregroundStyle(T.faint)
        }
        .fixedSize()
    }

    private var accessibilitySummary: String {
        guard let top = points.max(by: { $0.value < $1.value }) else { return "No spending" }
        return "\(points.count) days with spending. Highest \(top.value.money()) on \(top.date.formatted(.dateTime.month(.wide).day()))."
    }
}

/// Compact, non-interactive bars for tiles and sheets. Days with no spend still
/// take a slot so the rhythm of the month reads correctly — gaps are the signal.
struct MiniBars: View {
    let values: [Double]
    var height: CGFloat = 40
    var color: Color = T.brass

    var body: some View {
        Canvas { ctx, size in
            guard !values.isEmpty else { return }
            let maxV = max(1, values.max() ?? 1)
            let slot = size.width / CGFloat(values.count)
            let barW = max(1.5, slot * 0.58)
            for (i, v) in values.enumerated() {
                let h = max(1.5, CGFloat(v / maxV) * (size.height - 2))
                let rect = CGRect(x: CGFloat(i) * slot + (slot - barW) / 2, y: size.height - h, width: barW, height: h)
                ctx.fill(Path(roundedRect: rect, cornerRadius: min(1.5, barW / 2)), with: .color(color.opacity(v > 0 ? 0.88 : 0.25)))
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

/// Cumulative spend against the even-pace line — the reading that predicts a
/// blown month rather than reporting it afterwards. Jade while under pace,
/// coral once the solid line has crossed above the dashes. Draws itself in.
struct PaceChart: View {
    /// Running total for each day of the month so far, day 1 first.
    let cumulative: [Double]
    let budget: Double
    let daysInMonth: Int
    let dayOfMonth: Int
    var height: CGFloat = 112

    @State private var drawn: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var spent: Double { cumulative.last ?? 0 }

    /// No budget? Pace against the month's own run rate, so there is still a
    /// reference line rather than silently none.
    private var target: Double {
        budget > 0 ? budget : spent / Double(max(1, dayOfMonth)) * Double(daysInMonth)
    }

    private var ahead: Bool { spent > target * Double(dayOfMonth) / Double(max(1, daysInMonth)) }
    private var color: Color { ahead ? T.coral : T.jade }
    private var yMax: Double { max(target, spent, 1) }

    var body: some View {
        ZStack {
            PaceGuide(target: target, yMax: yMax)
                .stroke(T.faint, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))

            PaceArea(values: cumulative, yMax: yMax, days: daysInMonth)
                .fill(LinearGradient(colors: [color.opacity(0.24), color.opacity(0)], startPoint: .top, endPoint: .bottom))
                .opacity(Double(drawn))

            PaceLineShape(values: cumulative, yMax: yMax, days: daysInMonth)
                .trim(from: 0, to: drawn)
                .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

            GeometryReader { geo in
                let p = PaceGeometry(size: geo.size, yMax: yMax, days: daysInMonth)
                Circle()
                    .fill(color)
                    .overlay(Circle().strokeBorder(T.ink, lineWidth: 1.5))
                    .frame(width: 8, height: 8)
                    .position(p.point(cumulative.count - 1, spent))
                    .opacity(drawn >= 1 ? 1 : 0)
            }
        }
        .frame(height: height)
        .onAppear {
            if reduceMotion { drawn = 1 } else { withAnimation(.easeOut(duration: 0.7).delay(0.1)) { drawn = 1 } }
        }
        .accessibilityElement()
        .accessibilityLabel("Cumulative spending against an even pace")
        .accessibilityValue(ahead ? "Ahead of pace" : "Under pace")
    }
}

/// Shared mapping from (day index, amount) to a point in the chart's frame.
private struct PaceGeometry {
    let size: CGSize
    let yMax: Double
    let days: Int

    func point(_ i: Int, _ v: Double) -> CGPoint {
        let x = CGFloat(i) / CGFloat(max(1, days - 1)) * size.width
        let y = 3 + (1 - CGFloat(v / yMax)) * (size.height - 6)
        return CGPoint(x: x, y: y)
    }
}

private struct PaceGuide: Shape {
    let target: Double
    let yMax: Double

    func path(in rect: CGRect) -> Path {
        let g = PaceGeometry(size: rect.size, yMax: yMax, days: 2)
        var p = Path()
        p.move(to: g.point(0, 0))
        p.addLine(to: g.point(1, target))
        return p
    }
}

private struct PaceLineShape: Shape {
    let values: [Double]
    let yMax: Double
    let days: Int

    func path(in rect: CGRect) -> Path {
        let g = PaceGeometry(size: rect.size, yMax: yMax, days: days)
        var p = Path()
        for (i, v) in values.enumerated() {
            if i == 0 { p.move(to: g.point(i, v)) } else { p.addLine(to: g.point(i, v)) }
        }
        return p
    }
}

private struct PaceArea: Shape {
    let values: [Double]
    let yMax: Double
    let days: Int

    func path(in rect: CGRect) -> Path {
        guard !values.isEmpty else { return Path() }
        var p = PaceLineShape(values: values, yMax: yMax, days: days).path(in: rect)
        let g = PaceGeometry(size: rect.size, yMax: yMax, days: days)
        p.addLine(to: CGPoint(x: g.point(values.count - 1, 0).x, y: rect.height))
        p.addLine(to: CGPoint(x: 0, y: rect.height))
        p.closeSubpath()
        return p
    }
}

/// One slice of the mix.
struct MixSlice: Identifiable, Equatable {
    let id: String
    let name: String
    let value: Double
    let color: Color
}

/// The allocation donut — hairline gaps between slices, and the centre reads
/// the slice under your finger (or the total when nothing is selected).
struct MixDonut: View {
    let slices: [MixSlice]
    var size: CGFloat = 116

    @State private var selectedAngle: Double?

    private var total: Double { slices.reduce(0) { $0 + $1.value } }

    private var selected: MixSlice? {
        guard let angle = selectedAngle else { return nil }
        var running = 0.0
        for s in slices {
            running += s.value
            if angle <= running { return s }
        }
        return slices.last
    }

    var body: some View {
        Chart(slices) { s in
            SectorMark(
                angle: .value("Spent", s.value),
                innerRadius: .ratio(0.64),
                angularInset: 1.2
            )
            .cornerRadius(2.5)
            .foregroundStyle(s.color)
            .opacity(selected == nil || selected?.id == s.id ? 1 : 0.35)
        }
        .chartLegend(.hidden)
        .chartAngleSelection(value: $selectedAngle)
        .chartBackground { _ in
            VStack(spacing: 1) {
                Text((selected?.value ?? total).moneyCompact())
                    .font(F.monoSemibold(13))
                    .foregroundStyle(T.paper)
                    .contentTransition(.numericText())
                Text(selected?.name ?? "total")
                    .font(F.body(9.5))
                    .foregroundStyle(T.faint)
                    .lineLimit(1)
                    .frame(maxWidth: size * 0.52)
            }
        }
        .frame(width: size, height: size)
        .onChange(of: selected?.id) { _, new in if new != nil { Haptics.tick() } }
        .animation(M.snappy, value: selected?.id)
        .accessibilityElement()
        .accessibilityLabel("Spending mix")
        .accessibilityValue(slices.prefix(3).map { "\($0.name) \($0.value.moneyCompact())" }.joined(separator: ", "))
    }
}
