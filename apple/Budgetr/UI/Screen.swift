import SwiftUI

// The screen scaffold — the companion's `Screen` (ui/screen.tsx) in the iOS
// large-title grammar:
//  - the Fraunces page title lives in the content and stretches a little on
//    overscroll, anchored to its leading edge, like Apple's large titles
//  - a compact material header materialises only once the title has scrolled
//    under it (a scroll-edge effect, never a permanent hard divider)
//  - the aurora drifts at 0.15× the scroll, so the atmosphere sits behind
//  - reduced motion keeps all of it except the stretch and the drift.

/// How far the scrollable content must leave clear at the bottom for chrome
/// floating over it — the phone's tab pill. Zero wherever there is none.
private struct ChromeClearanceKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    var chromeClearance: CGFloat {
        get { self[ChromeClearanceKey.self] }
        set { self[ChromeClearanceKey.self] = newValue }
    }
}

/// The page title's position, reported from inside the scroll content. `nil`
/// rather than zero when nothing reports, because a List recycles the row that
/// carries the reader, and "no report" must not read as "scrolled to the top".
struct TitleOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat? = nil
    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) {
        if let next = nextValue() { value = next }
    }
}

/// Measures where the view sits, for `TitleOffsetKey`.
struct TitleOffsetReader: View {
    var body: some View {
        GeometryReader { geo in
            Color.clear.preference(key: TitleOffsetKey.self, value: geo.frame(in: .global).minY)
        }
    }
}

/// Turns raw title positions into "how far has the page scrolled", relative to
/// wherever the title sat at rest — so the scaffold never has to know how tall
/// the navigation bar or the status bar is on this device.
struct ScrollTracking {
    private(set) var baseline: CGFloat?
    private(set) var offset: CGFloat = 0

    /// Positive when scrolled up (content moving away), negative on overscroll.
    mutating func update(_ y: CGFloat?) {
        guard let y else { return }
        if baseline == nil { baseline = y }
        let next = (baseline ?? y) - y
        // Half-point quantising keeps a long fling from re-rendering the page
        // for movement nobody could see.
        let q = (next * 2).rounded() / 2
        if q != offset { offset = q }
    }

    /// An offset read straight from the scroll view — no baseline to guess.
    mutating func set(_ value: CGFloat) {
        let q = (value * 2).rounded() / 2
        if q != offset { offset = q }
    }

    var collapsed: Bool { offset > 44 }
}

/// Feeds `ScrollTracking` from the scroll view itself where the OS can say
/// (iOS 18 / macOS 15), falling back to the title-position preference. The
/// preference path captures its baseline on the first report, which can land
/// before the navigation bar has settled — the page then reads as permanently
/// overscrolled and the title sits stretched. The geometry path has no
/// baseline to get wrong.
private struct ScrollOffsetFeed: ViewModifier {
    @Binding var tracking: ScrollTracking

    func body(content: Content) -> some View {
        if #available(iOS 18.0, macOS 15.0, *) {
            content.onScrollGeometryChange(for: CGFloat.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top
            } action: { _, y in
                tracking.set(y)
            }
        } else {
            content.onPreferenceChange(TitleOffsetKey.self) { tracking.update($0) }
        }
    }
}

/// A scrolling page with the PageHead, aurora and compact header.
struct BScreen<Trailing: View, Content: View>: View {
    let title: String
    var eyebrow: String?
    @ViewBuilder let trailing: Trailing
    @ViewBuilder let content: Content

    @State private var tracking = ScrollTracking()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.chromeClearance) private var clearance

    init(
        _ title: String,
        eyebrow: String? = nil,
        @ViewBuilder trailing: () -> Trailing,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.eyebrow = eyebrow
        self.trailing = trailing()
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageHead(title: title, eyebrow: eyebrow ?? Date().pageEyebrow) { trailing }
                    .scaleEffect(stretch, anchor: .bottomLeading)
                    .background(TitleOffsetReader())
                content
            }
            .padding(.horizontal, 18)
            .padding(.top, 6)
            .padding(.bottom, 28 + clearance)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .modifier(ScrollOffsetFeed(tracking: $tracking))
        .background(AuroraBackground(drift: reduceMotion ? 0 : -tracking.offset * 0.15))
        .navigationTitle(title)
        .compactHeader(title: title, visible: tracking.collapsed)
    }

    /// Large-title rubber-banding: up to 6% bigger on a 100pt pull.
    private var stretch: CGFloat {
        guard !reduceMotion, tracking.offset < 0 else { return 1 }
        return 1 + min(0.06, -tracking.offset / 100 * 0.06)
    }
}

extension BScreen where Trailing == EmptyView {
    init(_ title: String, eyebrow: String? = nil, @ViewBuilder content: () -> Content) {
        self.init(title, eyebrow: eyebrow, trailing: { EmptyView() }, content: content)
    }
}

/// The compact header: an inline title and a material bar that fade in once the
/// page title has gone under them. The Mac's window title bar already does
/// this job, so it's iOS only.
struct CompactHeader: ViewModifier {
    let title: String
    let visible: Bool

    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .font(F.semibold(15))
                        .foregroundStyle(T.paper)
                        .opacity(visible ? 1 : 0)
                        .animation(.easeOut(duration: 0.18), value: visible)
                }
            }
            .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            .toolbarBackground(visible ? .visible : .hidden, for: .navigationBar)
        #else
        content
        #endif
    }
}

extension View {
    func compactHeader(title: String, visible: Bool) -> some View {
        modifier(CompactHeader(title: title, visible: visible))
    }
}

/// The dark sheet chrome every modal shares: panel background, a generous
/// continuous corner, a visible grabber, and a thud as it lands.
struct BSheet: ViewModifier {
    var detents: Set<PresentationDetent> = [.medium, .large]

    func body(content: Content) -> some View {
        content
            .presentationDetents(detents)
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(28)
            .presentationBackground(T.panel)
            .preferredColorScheme(.dark)
            .onAppear { Haptics.thud() }
    }
}

extension View {
    func bSheet(_ detents: Set<PresentationDetent> = [.medium, .large]) -> some View {
        modifier(BSheet(detents: detents))
    }
}
