import SwiftUI

/// budgetr's visual identity, ported from `web/app/globals.css`.
///
/// The same hex values and the same three typefaces the web app and the phone
/// companion use, so the native app reads as the same product rather than a
/// second one that happens to show your money. Anything that needs a colour
/// takes it from here — a literal in a view is how three apps drift apart.
enum T {
    // Canvas and surfaces
    static let ink = Color(hex: 0x080B0A)        // page
    static let panel = Color(hex: 0x131A18)      // card
    static let panel2 = Color(hex: 0x1C2421)     // raised / hover
    static let line = Color(hex: 0x2B3531)       // hairline
    static let lineStrong = Color(hex: 0x3A4742)

    // Text
    static let paper = Color(hex: 0xECE7DA)      // primary — warm ivory
    static let muted = Color(hex: 0x8B948C)      // secondary
    static let faint = Color(hex: 0x5D655F)      // tertiary / axis

    // Meaning. Semantic, never decorative: jade is money arriving or a budget
    // held, coral is money leaving badly, brass is a hairline accent.
    static let jade = Color(hex: 0x6FE3A6)
    static let jadeDeep = Color(hex: 0x2F9D72)
    static let coral = Color(hex: 0xF0897B)
    static let brass = Color(hex: 0xCBB07C)
    static let brassDim = Color(hex: 0x8A7748)
    static let blue = Color(hex: 0x7FB2E0)

    static let onJade = Color(hex: 0x06120C)
    static let onBrass = Color(hex: 0x1A1505)

    /// The categorical palette used by every chart, in order — matching
    /// `PIE_COLORS` on the web so a category keeps its colour across apps.
    static let chart: [Color] = [
        Color(hex: 0x6FE3A6), Color(hex: 0xCBB07C), Color(hex: 0x7FB2E0),
        Color(hex: 0xC98BD0), Color(hex: 0xE0A26B), Color(hex: 0x7FD0C4),
        Color(hex: 0xA8B57A), Color(hex: 0xE28C8C),
    ]

    static let radius: CGFloat = 14
}

/// The three faces, by role. Display is Fraunces (figures and titles), body is
/// Hanken Grotesk, and anything that lines up in a column is Spline Sans Mono.
enum F {
    static func display(_ size: CGFloat) -> Font { .custom("Fraunces-SemiBold", size: size) }
    static func displayBold(_ size: CGFloat) -> Font { .custom("Fraunces-Bold", size: size) }
    static func body(_ size: CGFloat) -> Font { .custom("HankenGrotesk-Regular", size: size) }
    static func medium(_ size: CGFloat) -> Font { .custom("HankenGrotesk-Medium", size: size) }
    static func semibold(_ size: CGFloat) -> Font { .custom("HankenGrotesk-SemiBold", size: size) }
    static func mono(_ size: CGFloat) -> Font { .custom("SplineSansMono-Medium", size: size) }
    static func monoSemibold(_ size: CGFloat) -> Font { .custom("SplineSansMono-SemiBold", size: size) }
}

// ── Shared chrome ────────────────────────────────────────────────────

/// The web app's `.eyebrow`: small, tracked, uppercase, brass.
struct Eyebrow: View {
    let text: String
    var color: Color = T.brass

    init(_ text: String, color: Color = T.brass) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(F.mono(10))
            .tracking(1.3)
            .foregroundStyle(color)
    }
}

/// The web app's `.card` — a panel on the canvas with a hairline border.
struct Panel<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder let content: Content

    init(padding: CGFloat = 16, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(T.panel, in: RoundedRectangle(cornerRadius: T.radius))
            .overlay(
                RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.line, lineWidth: 1)
            )
    }
}

/// A titled panel — the shape most of the app is made of.
struct TitledPanel<Content: View>: View {
    let title: String
    var trailing: String?
    @ViewBuilder let content: Content

    init(_ title: String, trailing: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.trailing = trailing
        self.content = content()
    }

    var body: some View {
        Panel(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Eyebrow(title)
                    Spacer()
                    if let trailing {
                        Text(trailing).font(F.mono(11)).foregroundStyle(T.faint)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) { Rectangle().fill(T.line).frame(height: 1) }

                content.padding(16)
            }
        }
    }
}

/// A meter bar — budgets, allocation, anything with a share.
///
/// When `fraction` exceeds 1.0 the fill covers the track and a coral overflow
/// segment continues past the end so 10× over is visually distinct from 1.01×.
/// Parents should leave a little trailing room (see `overflowReserve`).
struct MeterBar: View {
    let fraction: Double
    var color: Color = T.jade
    /// Extra width reserved past the track for overflow, as a fraction of the
    /// track. Caps how far a huge overrun draws (still readable at 10×).
    var overflowReserve: CGFloat = 0.35

    var body: some View {
        GeometryReader { geo in
            let total = geo.size.width
            let ratio = max(0, fraction)
            // Under budget: track is the full width. Over: shrink the track so
            // the overflow segment has somewhere to go without clipping.
            let track = ratio > 1 ? total / (1 + overflowReserve) : total
            let fillInTrack = min(1, ratio) * track
            let overflowWidth = ratio > 1
                ? min(1, ratio - 1) * (total - track)
                : 0

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(T.panel2)
                    .frame(width: track)

                Capsule()
                    .fill(color)
                    .frame(width: fillInTrack)

                if overflowWidth > 0 {
                    Capsule()
                        .fill(color.opacity(0.55))
                        .frame(width: overflowWidth)
                        .offset(x: track)
                }
            }
        }
        .frame(height: 5)
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension Double {
    /// `$1,234.56`, in the app's convention.
    func money(_ code: String = "USD") -> String {
        self.formatted(.currency(code: code).precision(.fractionLength(2)))
    }

    /// `$1.2K` — for tiles and axes, where the cents are noise.
    func moneyCompact(_ code: String = "USD") -> String {
        let a = abs(self)
        let sign = self < 0 ? "-" : ""
        if a >= 1_000_000 { return "\(sign)$\((a / 1_000_000).formatted(.number.precision(.fractionLength(1))))M" }
        if a >= 1_000 { return "\(sign)$\((a / 1_000).formatted(.number.precision(.fractionLength(1))))K" }
        return "\(sign)$\(a.formatted(.number.precision(.fractionLength(0))))"
    }
}
