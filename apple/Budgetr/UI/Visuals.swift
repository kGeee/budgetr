import SwiftUI

// The second layer of the design system: the small visual instruments screens
// lean on to say a number at a glance — rings, deltas, merchant marks, stacked
// shares, skeletons, chips. Same rules as Components.swift: colour is meaning
// (jade held, brass ahead, coral over), motion settles without bouncing, and
// all of it falls back to still frames under Reduce Motion.

// ── Rings ────────────────────────────────────────────────────────────

/// A progress ring with an optional tick — "how much is gone" against "how much
/// of the month is". The arc draws in on appear; the track is the ink well every
/// meter in the app sits in. Past 100% the overflow wraps as a second, brighter
/// lap so an overspend is never clipped to "full".
struct RingGauge<Center: View>: View {
    let fraction: Double
    var color: Color = T.jade
    var lineWidth: CGFloat = 10
    /// 0…1 around the ring — usually the share of the month elapsed.
    var marker: Double?
    @ViewBuilder var center: Center

    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().stroke(T.ink, lineWidth: lineWidth)
            Circle().stroke(T.line, lineWidth: 0.75).padding(-lineWidth / 2)
            Circle().stroke(T.line, lineWidth: 0.75).padding(lineWidth / 2)

            Circle()
                .trim(from: 0, to: min(1, max(0, shown)))
                .stroke(
                    AngularGradient(colors: [color.opacity(0.55), color], center: .center, startAngle: .degrees(0), endAngle: .degrees(360 * max(0.01, min(1, shown)))),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .shadow(color: color.opacity(0.35), radius: 6)

            if shown > 1 {
                Circle()
                    .trim(from: 0, to: min(1, shown - 1))
                    .stroke(T.coral, style: StrokeStyle(lineWidth: lineWidth * 0.55, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }

            if let marker {
                GeometryReader { geo in
                    let r = min(geo.size.width, geo.size.height) / 2
                    Capsule()
                        .fill(T.paper)
                        .frame(width: 2.5, height: lineWidth + 7)
                        .shadow(color: .black.opacity(0.6), radius: 2)
                        .offset(y: -r)
                        .rotationEffect(.degrees(360 * min(1, max(0, marker))))
                        .frame(width: geo.size.width, height: geo.size.height)
                }
            }

            center
        }
        .padding(lineWidth / 2)
        .onAppear { animate(fraction) }
        .onChange(of: fraction) { _, v in animate(v) }
        .accessibilityElement(children: .combine)
    }

    private func animate(_ v: Double) {
        if reduceMotion { shown = v } else { withAnimation(.spring(response: 0.9, dampingFraction: 0.9).delay(0.12)) { shown = v } }
    }
}

extension RingGauge where Center == EmptyView {
    init(fraction: Double, color: Color = T.jade, lineWidth: CGFloat = 10, marker: Double? = nil) {
        self.init(fraction: fraction, color: color, lineWidth: lineWidth, marker: marker) { EmptyView() }
    }
}

// ── Deltas ───────────────────────────────────────────────────────────

/// `▲ 12%` in a tinted capsule. For spending, up is bad; for value, up is good —
/// the caller says which, and the colour follows.
struct DeltaPill: View {
    let pct: Double
    var upIsGood = false
    var size: CGFloat = 11.5

    private var up: Bool { pct > 0 }
    private var tint: Color {
        if abs(pct) < 0.5 { return T.muted }
        return up == upIsGood ? T.jade : T.coral
    }

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: size - 2, weight: .bold))
            Text("\(abs(pct) < 10 ? String(format: "%.1f", abs(pct)) : String(Int(abs(pct).rounded())))%")
                .font(F.monoSemibold(size))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 7)
        .padding(.vertical, 3.5)
        .background(Capsule().fill(tint.opacity(0.13)))
        .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 0.75))
        .accessibilityLabel("\(up ? "up" : "down") \(Int(abs(pct).rounded())) percent")
    }
}

// ── Merchants ────────────────────────────────────────────────────────

/// A merchant's mark: a monogram on a tile tinted by a stable hash of the name,
/// so "Blue Bottle" is always the same colour, with the category glyph riding
/// the corner. Reads faster in a long list than a column of identical icons.
struct MerchantAvatar: View {
    let name: String
    var icon: String?
    var size: CGFloat = 38
    var inflow = false

    private var hue: Color {
        if inflow { return T.jade }
        let palette = [T.brass, T.blue, Color(hex: 0xB59CE0), Color(hex: 0x5FC9C0), Color(hex: 0xE0C36F), Color(hex: 0xE08FB8), Color(hex: 0x9AD17F)]
        let h = name.unicodeScalars.reduce(UInt32(7)) { ($0 &* 31) &+ $1.value }
        return palette[Int(h % UInt32(palette.count))]
    }

    private var initials: String {
        let words = name.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        let letters = words.prefix(2).compactMap(\.first)
        return letters.isEmpty ? "·" : String(letters).uppercased()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
        ZStack {
            shape.fill(LinearGradient(colors: [hue.opacity(0.28), hue.opacity(0.1)], startPoint: .topLeading, endPoint: .bottomTrailing))
            shape.strokeBorder(hue.opacity(0.3), lineWidth: 0.75)
            Text(initials)
                .font(.custom("Fraunces-SemiBold", size: size * (initials.count > 1 ? 0.36 : 0.44)))
                .foregroundStyle(hue)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            ZStack {
                Circle().fill(T.panel2)
                Circle().strokeBorder(T.ink, lineWidth: 1.5)
                GlyphIcon(icon: icon, color: inflow ? T.jade : T.muted, size: size * 0.2)
            }
            .frame(width: size * 0.46, height: size * 0.46)
            .offset(x: size * 0.12, y: size * 0.12)
        }
        .accessibilityHidden(true)
    }
}

// ── Shares ───────────────────────────────────────────────────────────

/// One horizontal bar, split into proportional segments with hairline gaps —
/// a donut's information in a row's height. Segments grow in from the left.
struct StackedBar: View {
    let slices: [MixSlice]
    var height: CGFloat = 10

    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let total = max(slices.reduce(0) { $0 + $1.value }, 0.0001)
        GeometryReader { geo in
            let gap: CGFloat = 2
            let usable = geo.size.width - gap * CGFloat(max(0, slices.count - 1))
            HStack(spacing: gap) {
                ForEach(slices) { s in
                    RoundedRectangle(cornerRadius: height * 0.3, style: .continuous)
                        .fill(s.color)
                        .frame(width: max(2, usable * CGFloat(s.value / total)))
                }
            }
            .frame(width: geo.size.width, alignment: .leading)
            .mask(alignment: .leading) {
                Rectangle().frame(width: grown ? geo.size.width : 0)
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
        .onAppear {
            if reduceMotion { grown = true } else { withAnimation(.easeOut(duration: 0.7).delay(0.15)) { grown = true } }
        }
        .accessibilityElement()
        .accessibilityLabel(slices.map { "\($0.name) \(Int(($0.value / total * 100).rounded())) percent" }.joined(separator: ", "))
    }
}

/// A legend line — swatch, name, value — shared by every split chart.
struct LegendRow: View {
    let color: Color
    let name: String
    let value: String
    var detail: String?

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2.5, style: .continuous).fill(color).frame(width: 9, height: 9)
            Text(name).font(F.body(12)).foregroundStyle(T.muted).lineLimit(1)
            Spacer(minLength: 6)
            if let detail {
                Text(detail).font(F.mono(10.5)).foregroundStyle(T.faint)
            }
            Text(value).font(F.mono(12)).foregroundStyle(T.paper)
        }
        .accessibilityElement(children: .combine)
    }
}

// ── Chips ────────────────────────────────────────────────────────────

/// A row of filter chips with counts. The active chip fills; the rest are
/// outlined. Scrolls sideways if it has to, but is sized to fit a phone.
struct FilterChips<Value: Hashable>: View {
    struct Option {
        let label: String
        let value: Value
        var count: Int?
        var symbol: String?
    }

    let options: [Option]
    @Binding var selection: Value
    @Namespace private var ns

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 7) {
                ForEach(options.indices, id: \.self) { i in
                    chip(options[i])
                }
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
    }

    private func chip(_ o: Option) -> some View {
        let active = o.value == selection
        return Button {
            guard !active else { return }
            Haptics.tick()
            withAnimation(M.snappy) { selection = o.value }
        } label: {
            HStack(spacing: 6) {
                if let symbol = o.symbol {
                    Image(systemName: symbol).font(.system(size: 10.5, weight: .semibold))
                }
                Text(o.label).font(F.semibold(12.5))
                if let count = o.count {
                    Text("\(count)")
                        .font(F.mono(10.5))
                        .foregroundStyle(active ? T.onJade.opacity(0.7) : T.faint)
                        .contentTransition(.numericText())
                }
            }
            .foregroundStyle(active ? T.onJade : T.muted)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background {
                if active {
                    Capsule().fill(T.jade).matchedGeometryEffect(id: "chip", in: ns)
                } else {
                    Capsule().fill(T.panel.opacity(0.8))
                }
            }
            .overlay(Capsule().strokeBorder(active ? .clear : T.line, lineWidth: 0.75))
            .contentShape(Capsule())
        }
        .buttonStyle(.pressScale)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

// ── Banners ──────────────────────────────────────────────────────────

/// A tinted notice with an icon tile — alerts, stale data, hints.
struct NoticeBanner: View {
    let symbol: String
    let text: String
    var tint: Color = T.coral
    var badge: String?
    var chevron = true

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: symbol)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tint.opacity(0.16)))
            Text(text)
                .font(F.body(12.5))
                .foregroundStyle(T.paper)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            if let badge {
                Text(badge)
                    .font(F.monoSemibold(10.5))
                    .foregroundStyle(tint)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(tint.opacity(0.15)))
            }
            if chevron {
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(T.faint)
            }
        }
        .padding(.leading, 9)
        .padding(.trailing, 12)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(LinearGradient(colors: [tint.opacity(0.13), tint.opacity(0.04)], startPoint: .leading, endPoint: .trailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(tint.opacity(0.35), lineWidth: 0.75))
    }
}

// ── Glow ─────────────────────────────────────────────────────────────

extension View {
    /// A soft wash of colour bleeding from behind a hero — the state of the
    /// number, felt before it is read. Sits under the content, never on it.
    func heroGlow(_ color: Color, alignment: Alignment = .topLeading) -> some View {
        background(alignment: alignment) {
            Circle()
                .fill(RadialGradient(colors: [color.opacity(0.22), color.opacity(0)], center: .center, startRadius: 0, endRadius: 150))
                .frame(width: 300, height: 300)
                .offset(x: alignment == .topLeading ? -110 : 110, y: -120)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

// ── Live ─────────────────────────────────────────────────────────────

/// A dot that breathes — something is live. Still under Reduce Motion.
struct PulseDot: View {
    var color: Color = T.jade
    var size: CGFloat = 7

    @State private var pulsing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.45))
                .frame(width: size, height: size)
                .scaleEffect(pulsing ? 2.6 : 1)
                .opacity(pulsing ? 0 : 0.8)
            Circle().fill(color).frame(width: size, height: size)
        }
        .frame(width: size * 2.6, height: size * 2.6)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { pulsing = true }
        }
        .accessibilityHidden(true)
    }
}

// ── Loading ──────────────────────────────────────────────────────────

/// A sheen that sweeps across placeholder shapes while something loads.
struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(colors: [.clear, Color.white.opacity(0.07), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width * 0.6)
                            .offset(x: phase * geo.size.width * 1.4)
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                }
            }
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1.2 }
            }
    }
}

extension View {
    func shimmer() -> some View { modifier(Shimmer()) }
}

/// A rounded placeholder block.
struct SkeletonBlock: View {
    var width: CGFloat?
    var height: CGFloat = 12
    var radius: CGFloat = 6

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(T.panel2)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// ── Section header ───────────────────────────────────────────────────

/// An eyebrow with an optional trailing action, for the groups between cards.
struct SectionHeader: View {
    let title: String
    var detail: String?
    var action: (label: String, run: () -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Eyebrow(title)
            if let detail {
                Text(detail).font(F.mono(10.5)).foregroundStyle(T.faint)
            }
            Spacer(minLength: 8)
            if let action {
                Button {
                    Haptics.tap()
                    action.run()
                } label: {
                    Text(action.label).font(F.semibold(12)).foregroundStyle(T.brass)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 4)
    }
}

// ── Ranges ───────────────────────────────────────────────────────────

/// Low to high with where the value sits between them — a day's range, a
/// 52-week range. The marker is the read; the ends are the context.
struct RangeBar: View {
    let label: String
    let low: Double
    let high: Double
    let value: Double
    var format: (Double) -> String = { $0.money() }

    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var fraction: Double {
        guard high > low else { return 0.5 }
        return max(0, min(1, (value - low) / (high - low)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label.uppercased()).font(F.mono(9.5)).tracking(0.9).foregroundStyle(T.muted)
                Spacer()
                Text("\(Int((fraction * 100).rounded()))% of range").font(F.mono(9.5)).foregroundStyle(T.faint)
            }
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(T.ink).overlay(Capsule().strokeBorder(T.line, lineWidth: 0.75))
                    Capsule()
                        .fill(LinearGradient(colors: [T.coral.opacity(0.55), T.brass.opacity(0.55), T.jade.opacity(0.7)], startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(6, w * (shown ? fraction : 0)))
                    Circle()
                        .fill(T.paper)
                        .overlay(Circle().strokeBorder(T.ink, lineWidth: 2))
                        .frame(width: 12, height: 12)
                        .offset(x: max(0, min(w - 12, w * (shown ? fraction : 0) - 6)))
                }
            }
            .frame(height: 6)
            HStack {
                Text(format(low)).font(F.mono(11)).foregroundStyle(T.muted)
                Spacer()
                Text(format(high)).font(F.mono(11)).foregroundStyle(T.muted)
            }
        }
        .onAppear {
            if reduceMotion { shown = true } else { withAnimation(M.settle.delay(0.15)) { shown = true } }
        }
        .accessibilityElement()
        .accessibilityLabel("\(label): \(format(value)), between \(format(low)) and \(format(high))")
    }
}
