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

    /// The categorical palette used by every chart, in order — the companion's
    /// `PIE_COLORS` (itself the desktop's), so a category keeps its colour
    /// across all three apps.
    static let chart: [Color] = [
        jade, brass, blue, coral,
        Color(hex: 0xB59CE0), Color(hex: 0x5FC9C0), Color(hex: 0xE0C36F),
        Color(hex: 0x9AD17F), Color(hex: 0xE08FB8), muted,
    ]

    /// Card corner radius — the companion's 18, which reads softer on glass
    /// than the web's 14 and is what the floating tab pill was drawn against.
    static let radius: CGFloat = 18
    /// Recessed wells inside a card: stat tiles, category tiles, chips.
    static let radiusSmall: CGFloat = 14
}

/// The three faces, by role. Display is Fraunces (figures and titles), body is
/// Hanken Grotesk, and anything that lines up in a column is Spline Sans Mono.
///
/// Every face scales with Dynamic Type relative to the text style it stands in
/// for, so a reader who has asked for bigger text gets it here too.
enum F {
    static func display(_ size: CGFloat) -> Font { .custom("Fraunces-SemiBold", size: size, relativeTo: .largeTitle) }
    static func displayBold(_ size: CGFloat) -> Font { .custom("Fraunces-Bold", size: size, relativeTo: .largeTitle) }
    static func body(_ size: CGFloat) -> Font { .custom("HankenGrotesk-Regular", size: size, relativeTo: .body) }
    static func medium(_ size: CGFloat) -> Font { .custom("HankenGrotesk-Medium", size: size, relativeTo: .body) }
    static func semibold(_ size: CGFloat) -> Font { .custom("HankenGrotesk-SemiBold", size: size, relativeTo: .body) }
    static func mono(_ size: CGFloat) -> Font { .custom("SplineSansMono-Medium", size: size, relativeTo: .callout) }
    static func monoSemibold(_ size: CGFloat) -> Font { .custom("SplineSansMono-SemiBold", size: size, relativeTo: .callout) }
}

/// Motion, in Apple's fluid-interface grammar: critically damped springs that
/// settle without bouncing, and a stagger short enough that a screen of cards
/// lands as one gesture rather than a slideshow.
enum M {
    static let snappy = Animation.spring(response: 0.3, dampingFraction: 1.0)
    static let settle = Animation.spring(response: 0.42, dampingFraction: 0.86)
    static let sheet = Animation.spring(response: 0.38, dampingFraction: 0.92)
    static let stagger: Double = 0.055
}

/// Budget state → colour, the companion's `stateColor`.
enum BudgetState {
    case ok, warn, over

    var color: Color {
        switch self {
        case .ok: return T.jade
        case .warn: return T.brass
        case .over: return T.coral
        }
    }

    /// Over the limit is coral; ahead of an even pace (or inside the last 15%)
    /// is brass; anything else is held.
    static func of(spent: Double, limit: Double, pacing: BudgetPacing? = nil) -> BudgetState {
        guard limit > 0 else { return .ok }
        if spent > limit { return .over }
        if spent > limit * 0.85 { return .warn }
        if let pacing, pacing.isAheadOfPace { return .warn }
        return .ok
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

    /// `#6FE3A6` / `6fe3a6` → a colour, or nil for anything else (the web app
    /// stores category colours as nullable free text).
    init?(hexString raw: String?) {
        guard var s = raw?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(hex: v)
    }
}

extension Double {
    /// `$1,234.56`, in the app's convention.
    func money(_ code: String = "USD") -> String {
        self.formatted(.currency(code: code).precision(.fractionLength(2)))
    }

    /// `$1,234` — whole dollars, for heroes where the cents are noise but the
    /// thousands separator isn't.
    func moneyWhole(_ code: String = "USD") -> String {
        self.formatted(.currency(code: code).precision(.fractionLength(0)))
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

extension Date {
    /// `Saturday, October 17` — the companion's page eyebrow.
    var pageEyebrow: String {
        formatted(.dateTime.weekday(.wide).month(.wide).day())
    }
}
