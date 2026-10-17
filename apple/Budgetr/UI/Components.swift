import SwiftUI

// The companion's design system (mobile/src/ui/bits.tsx + motion.tsx), as
// native SwiftUI: gradient cards with a soft drop, the brass eyebrow, recessed
// stat wells, the pill segmented control, the striped allowance meter, and the
// press-down scale every tappable surface shares. Screens compose these rather
// than restyling primitives inline, so the three apps stay one product.

// ── Type ─────────────────────────────────────────────────────────────

/// The editorial micro-label — small, tracked, uppercase, brass.
struct Eyebrow: View {
    let text: String
    var color: Color = T.brass

    init(_ text: String, color: Color = T.brass) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(F.semibold(11))
            .tracking(1.8)
            .foregroundStyle(color)
            .lineLimit(1)
    }
}

/// The page head: eyebrow over a Fraunces display title, a hairline below, and
/// an optional trailing slot for chips.
struct PageHead<Trailing: View>: View {
    let title: String
    let eyebrow: String
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(eyebrow)
                Text(title)
                    .font(F.display(32))
                    .tracking(-0.3)
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
            trailing
        }
        .padding(.bottom, 16)
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isHeader)
    }
}

struct Hairline: View {
    var color: Color = T.line

    var body: some View {
        Rectangle().fill(color).frame(height: 1 / displayScale)
    }

    @Environment(\.displayScale) private var displayScale
}

// ── Surfaces ─────────────────────────────────────────────────────────

/// The card: a panel-2 → panel gradient, a hairline border with a faint lit top
/// edge, and the soft ambient drop the companion calls `--elev-2`.
struct Card<Content: View>: View {
    var padding: CGFloat = 18
    @ViewBuilder let content: Content

    init(padding: CGFloat = 18, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CardSurface())
    }
}

/// The card's material on its own, for surfaces that lay out their own content.
struct CardSurface: View {
    var radius: CGFloat = T.radius

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape
            .fill(LinearGradient(colors: [T.panel2, T.panel], startPoint: .top, endPoint: .bottom))
            .overlay(shape.strokeBorder(T.line, lineWidth: 0.75))
            .overlay(
                // The lit top edge: a highlight that fades out by a third of the
                // way down, so the card reads as raised rather than outlined.
                shape.strokeBorder(
                    LinearGradient(
                        colors: [Color.white.opacity(0.07), .clear],
                        startPoint: .top,
                        endPoint: UnitPoint(x: 0.5, y: 0.35)
                    ),
                    lineWidth: 0.75
                )
            )
            .shadow(color: .black.opacity(0.45), radius: 16, x: 0, y: 8)
    }
}

/// A titled card — the shape most of the app is made of.
struct TitledCard<Content: View, Accessory: View>: View {
    let title: String
    @ViewBuilder let accessory: Accessory
    @ViewBuilder let content: Content

    init(_ title: String, @ViewBuilder accessory: () -> Accessory, @ViewBuilder content: () -> Content) {
        self.title = title
        self.accessory = accessory()
        self.content = content()
    }

    var body: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Eyebrow(title)
                    Spacer(minLength: 8)
                    accessory
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 13)
                .overlay(alignment: .bottom) { Hairline() }

                content.padding(18)
            }
        }
    }
}

extension TitledCard where Accessory == Text {
    init(_ title: String, trailing: String? = nil, @ViewBuilder content: () -> Content) {
        self.init(title, accessory: {
            Text(trailing ?? "").font(F.mono(11)).foregroundStyle(T.faint)
        }, content: content)
    }
}

/// A recessed well on a card: small uppercase caption over a mono value. Tint
/// colours only the value — functional colour, never the whole tile.
struct StatTile: View {
    let label: String
    let value: String
    var tint: Color = T.paper
    var note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(F.mono(9.5))
                .tracking(0.9)
                .foregroundStyle(T.muted)
                .lineLimit(1)
            Text(value)
                .font(F.monoSemibold(17))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
            if let note {
                Text(note)
                    .font(F.mono(9.5))
                    .foregroundStyle(T.faint)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(T.panel.opacity(0.85))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(T.line, lineWidth: 0.75)
                )
        )
        .accessibilityElement(children: .combine)
    }
}

// ── Controls ─────────────────────────────────────────────────────────

/// The pill toggle: a recessed track with one raised segment that slides to the
/// selection. A tick fires on change, never on re-selecting the active one.
struct Segmented<Value: Hashable>: View {
    let options: [(label: String, value: Value)]
    @Binding var selection: Value

    @Namespace private var ns
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options.indices, id: \.self) { i in
                let option = options[i]
                let active = option.value == selection
                Button {
                    guard !active else { return }
                    Haptics.tick()
                    withAnimation(reduceMotion ? .easeOut(duration: 0.15) : M.snappy) {
                        selection = option.value
                    }
                } label: {
                    Text(option.label)
                        .font(F.semibold(12.5))
                        .foregroundStyle(active ? T.paper : T.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background {
                            if active {
                                Capsule()
                                    .fill(T.panel2)
                                    .overlay(Capsule().strokeBorder(T.lineStrong, lineWidth: 0.75))
                                    .matchedGeometryEffect(id: "segment", in: ns)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Capsule().fill(T.ink))
        .overlay(Capsule().strokeBorder(T.line, lineWidth: 0.75))
    }
}

/// Scales down the instant a finger lands and springs back on release —
/// feedback on press-down is the whole point. Reduced motion dims instead.
struct PressScale: ButtonStyle {
    var scale: CGFloat = 0.97

    func makeBody(configuration: Configuration) -> some View {
        PressScaleBody(configuration: configuration, scale: scale)
    }

    private struct PressScaleBody: View {
        let configuration: ButtonStyleConfiguration
        let scale: CGFloat
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            configuration.label
                .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
                .opacity(configuration.isPressed && reduceMotion ? 0.7 : 1)
                .animation(M.snappy, value: configuration.isPressed)
        }
    }
}

extension ButtonStyle where Self == PressScale {
    static var pressScale: PressScale { PressScale() }
}

/// A round chip button — the companion's wallet / settings chips.
struct IconChip: View {
    let systemName: String
    var badge: Bool = false
    var label: String
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(T.muted)
                .frame(width: 36, height: 36)
                .background(Circle().fill(T.panel))
                .overlay(Circle().strokeBorder(T.line, lineWidth: 0.75))
                .overlay(alignment: .topTrailing) {
                    if badge {
                        Circle()
                            .fill(T.coral)
                            .frame(width: 8, height: 8)
                            .overlay(Circle().strokeBorder(T.panel, lineWidth: 1.5))
                            .offset(x: -5, y: 5)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.pressScale)
        .accessibilityLabel(label)
    }
}

/// A full-width pill action, for sheets and settings.
struct PillButton: View {
    let title: String
    var systemImage: String?
    var role: Role = .standard
    let action: () -> Void

    enum Role { case standard, primary, destructive }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 13, weight: .semibold)) }
                Text(title).font(F.semibold(14.5))
            }
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Capsule().fill(background))
            .overlay(Capsule().strokeBorder(border, lineWidth: 0.75))
            .contentShape(Capsule())
        }
        .buttonStyle(.pressScale)
    }

    private var foreground: Color {
        switch role {
        case .standard: return T.paper
        case .primary: return T.onJade
        case .destructive: return T.coral
        }
    }

    private var background: Color {
        switch role {
        case .standard: return T.panel2
        case .primary: return T.jade
        case .destructive: return .clear
        }
    }

    private var border: Color {
        switch role {
        case .standard: return T.line
        case .primary: return T.jade
        case .destructive: return T.coral.opacity(0.4)
        }
    }
}

// ── Meters ───────────────────────────────────────────────────────────

/// The striped allowance meter: a solid fill up to the share used, a hatched
/// remainder in the same hue, and an ivory thumb riding the boundary. Reads as
/// "how much of the allowance is gone" at a glance. Fills in on appear.
struct StripedMeter: View {
    let fraction: Double
    var color: Color = T.jade
    var height: CGFloat = 12

    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let r = height / 2
            let p = max(0, min(1, shown))
            let fillW = w * p

            ZStack(alignment: .leading) {
                Capsule().fill(T.ink)

                Canvas { ctx, size in
                    let step: CGFloat = 7
                    var x: CGFloat = -size.height
                    while x < size.width + size.height {
                        var stripe = Path()
                        stripe.move(to: CGPoint(x: x, y: size.height))
                        stripe.addLine(to: CGPoint(x: x + size.height, y: 0))
                        ctx.stroke(stripe, with: .color(color.opacity(0.38)), lineWidth: 2.2)
                        x += step
                    }
                }
                .clipShape(Capsule())

                if p > 0 {
                    Capsule()
                        .fill(color)
                        .frame(width: max(fillW, height))
                }

                Circle()
                    .fill(T.paper)
                    .overlay(Circle().strokeBorder(color, lineWidth: 2))
                    .frame(width: height - 1, height: height - 1)
                    .offset(x: max(0, min(w - height, fillW - r)) + 0.5)
            }
        }
        .frame(height: height)
        .onAppear { animate(to: fraction) }
        .onChange(of: fraction) { _, new in animate(to: new) }
        .accessibilityElement()
        .accessibilityLabel("\(Int((fraction * 100).rounded())) percent used")
    }

    private func animate(to value: Double) {
        if reduceMotion {
            shown = value
        } else {
            withAnimation(M.settle.delay(0.08)) { shown = value }
        }
    }
}

/// The slim share bar — tiles and list rows, where a full meter is too loud.
struct SlimMeter: View {
    let fraction: Double
    var color: Color = T.jade
    var height: CGFloat = 3

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(T.ink)
                Capsule()
                    .fill(color)
                    .frame(width: max(height, geo.size.width * max(0, min(1, fraction))))
            }
        }
        .frame(height: height)
    }
}

// ── Money ────────────────────────────────────────────────────────────

/// Money that rolls to its value — digit by digit, from whatever is on screen
/// when the target changes, so an edit reads as the number moving rather than
/// being replaced. Reduced motion snaps.
struct AnimatedMoney: View {
    let value: Double
    var font: Font = F.display(44)
    var color: Color = T.paper
    var whole = false

    @State private var shown: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(whole ? shown.moneyWhole() : shown.money())
            .font(font)
            .tracking(-1)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .contentTransition(.numericText(value: shown))
            .onAppear { roll(to: value) }
            .onChange(of: value) { _, new in roll(to: new) }
            .accessibilityLabel(value.money())
    }

    private func roll(to target: Double) {
        if reduceMotion {
            shown = target
        } else {
            withAnimation(.spring(response: 0.55, dampingFraction: 1.0)) { shown = target }
        }
    }
}

// ── Atmosphere ───────────────────────────────────────────────────────

/// The desktop's atmospheric base: a jade aurora top-left and a brass wash
/// top-right over the ink canvas. `drift` moves it at a fraction of the scroll
/// for depth — the atmosphere sits further away than the content.
struct AuroraBackground: View {
    var drift: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = max(geo.size.height, 600)
            ZStack {
                T.ink
                Rectangle()
                    .fill(EllipticalGradient(
                        colors: [T.jade.opacity(0.085), T.jade.opacity(0)],
                        center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5
                    ))
                    .frame(width: w * 1.8, height: h * 0.9)
                    .position(x: w * 0.12, y: -h * 0.08 + drift)
                Rectangle()
                    .fill(EllipticalGradient(
                        colors: [T.brass.opacity(0.06), T.brass.opacity(0)],
                        center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5
                    ))
                    .frame(width: w * 1.4, height: h * 0.76)
                    .position(x: w, y: drift)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Staggered entrance: a gentle rise and fade, or a pure fade under reduced
/// motion. `index` is the card's place on the page.
struct Rise: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 14)
            .onAppear {
                guard !shown else { return }
                let delay = Double(min(index, 10)) * M.stagger
                withAnimation(reduceMotion ? .easeOut(duration: 0.18).delay(delay) : M.settle.delay(delay)) {
                    shown = true
                }
            }
    }
}

extension View {
    func rise(_ index: Int = 0) -> some View { modifier(Rise(index: index)) }
}

// ── Categories ───────────────────────────────────────────────────────

/// The web app stores a category's glyph as a lucide icon name (or an emoji).
/// This maps the seeded vocabulary to the closest SF Symbol, and passes emoji
/// through, so a category wears the same mark it does on the desktop.
enum CategoryGlyph {
    static func symbol(for icon: String?) -> String? {
        guard let icon, !icon.isEmpty else { return nil }
        switch icon {
        case "Wallet": return "wallet.pass"
        case "ArrowDownLeft": return "arrow.down.left"
        case "ArrowUpRight": return "arrow.up.right"
        case "Landmark": return "building.columns"
        case "Receipt": return "doc.text"
        case "Clapperboard": return "film"
        case "UtensilsCrossed", "Utensils": return "fork.knife"
        case "ShoppingBag", "ShoppingCart": return "bag"
        case "Hammer": return "hammer"
        case "HeartPulse", "Heart": return "heart"
        case "Sparkles": return "sparkles"
        case "Wrench": return "wrench.and.screwdriver"
        case "Building2", "Building": return "building.2"
        case "Car": return "car"
        case "Plane": return "airplane"
        case "Plug", "Zap": return "bolt"
        case "Users": return "person.2"
        case "ShieldCheck": return "checkmark.shield"
        case "Home", "House": return "house"
        case "Coffee": return "cup.and.saucer"
        case "Gift": return "gift"
        case "Dumbbell": return "dumbbell"
        case "GraduationCap": return "graduationcap"
        case "PawPrint": return "pawprint"
        case "Smartphone", "Phone": return "iphone"
        case "Music": return "music.note"
        case "Fuel": return "fuelpump"
        case "Baby": return "figure.and.child.holdinghands"
        default: return nil
        }
    }

    /// True when the stored icon is free text (an emoji) rather than a lucide name.
    static func isEmoji(_ icon: String?) -> Bool {
        guard let first = icon?.unicodeScalars.first else { return false }
        return !(first.isASCII)
    }
}

/// A category's mark in a tinted rounded tile.
struct GlyphTile: View {
    let icon: String?
    var color: Color = T.brass
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                .fill(color.opacity(0.13))
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                        .strokeBorder(color.opacity(0.22), lineWidth: 0.75)
                )
            glyph
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var glyph: some View {
        GlyphIcon(icon: icon, color: color, size: size * 0.42)
    }
}

/// A category's mark on its own — an SF Symbol tinted to the caller's colour,
/// or the emoji the user picked on the desktop.
struct GlyphIcon: View {
    let icon: String?
    var color: Color = T.brass
    var size: CGFloat = 13

    var body: some View {
        if CategoryGlyph.isEmoji(icon), let icon {
            Text(icon).font(.system(size: size * 1.1))
        } else {
            Image(systemName: CategoryGlyph.symbol(for: icon) ?? "tag")
                .font(.system(size: size, weight: .medium))
                .foregroundStyle(color)
        }
    }
}

// ── States ───────────────────────────────────────────────────────────

/// An empty or finished state, in the app's voice rather than the system's.
struct EmptyState<Actions: View>: View {
    let symbol: String
    let title: String
    let message: String
    @ViewBuilder let actions: Actions

    init(symbol: String, title: String, message: String, @ViewBuilder actions: () -> Actions) {
        self.symbol = symbol
        self.title = title
        self.message = message
        self.actions = actions()
    }

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(T.panel2).frame(width: 64, height: 64)
                Circle().strokeBorder(T.brassDim.opacity(0.6), lineWidth: 0.75).frame(width: 64, height: 64)
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(T.brass)
            }
            Text(title)
                .font(F.display(22))
                .foregroundStyle(T.paper)
                .multilineTextAlignment(.center)
            Text(message)
                .font(F.body(14))
                .foregroundStyle(T.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            actions.padding(.top, 6)
        }
        .padding(.vertical, 36)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
    }
}

extension EmptyState where Actions == EmptyView {
    init(symbol: String, title: String, message: String) {
        self.init(symbol: symbol, title: title, message: message) { EmptyView() }
    }
}

/// Sample-data ribbon. Permanent and unmissable on purpose: a finance app
/// quietly showing invented balances is the one failure mode worth spending
/// vertical space to prevent. Tapping it offers the way out.
struct SampleRibbon: View {
    let onExit: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            onExit()
        } label: {
            HStack(spacing: 10) {
                Text("SAMPLE DATA — NOT YOUR ACCOUNTS")
                    .font(F.semibold(10.5))
                    .tracking(1.1)
                Text("Exit")
                    .font(F.semibold(11))
                    .underline()
            }
            .foregroundStyle(T.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(T.brassDim)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Removes the sample data")
    }
}

/// The `b.` mark — the same italic serif letter and jade dot the desktop app,
/// the DMG and the phone all show.
struct BrandMark: View {
    var size: CGFloat = 30
    var showsWordmark = true

    var body: some View {
        HStack(spacing: size * 0.3) {
            ZStack(alignment: .bottomTrailing) {
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .fill(LinearGradient(colors: [T.panel2, T.panel], startPoint: .top, endPoint: .bottom))
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                            .strokeBorder(T.brassDim, lineWidth: max(0.75, size / 40))
                    )
                    .frame(width: size, height: size)

                Text("b")
                    .font(.custom("Fraunces-SemiBold", size: size * 0.62))
                    .italic()
                    .foregroundStyle(T.paper)
                    .offset(x: -size * 0.18, y: -size * 0.04)

                Circle()
                    .fill(T.jade)
                    .frame(width: size * 0.15, height: size * 0.15)
                    .offset(x: -size * 0.16, y: -size * 0.2)
            }
            .frame(width: size, height: size)

            if showsWordmark {
                Text("budgetr")
                    .font(.custom("Fraunces-SemiBold", size: size * 0.66))
                    .foregroundStyle(T.paper)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement()
        .accessibilityLabel("budgetr")
    }
}
