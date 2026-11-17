#if os(iOS)
import UIKit
#endif

/// Semantic haptics — the companion's `haptics.ts`, natively.
///
/// Named by intention rather than by generator, so the app reads as physical in
/// one consistent vocabulary: a tick when you scrub a chart or flip a segment, a
/// tap when a press opens something, a thud when a sheet or import commits, and
/// a notification pulse when something worked or didn't. Every call is
/// fire-and-forget and a no-op on the Mac, so callers never guard.
enum Haptics {
    /// Light selection tick — scrubbing a chart, crossing a value, toggling.
    static func tick() {
        #if os(iOS)
        UISelectionFeedbackGenerator().selectionChanged()
        #endif
    }

    /// A press landed — taps that open or commit something small.
    static func tap() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }

    /// A heavier commit — a sheet opening, a bulk change landing.
    static func thud() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
    }

    /// It worked — a transaction filed, an import finished.
    static func success() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }

    /// Cautionary — the first tap of a destructive action.
    static func warning() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        #endif
    }

    /// Something failed.
    static func error() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        #endif
    }
}
