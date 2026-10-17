import SwiftUI

/// The floating pill tab bar — the companion's signature nav (ui/tabbar.tsx).
///
/// One material pill hovering above the home indicator. The active tab alone
/// expands into a raised, jade-labelled capsule while the rest stay icon-only;
/// the capsule slides between tabs on a critically damped spring, so selection
/// moves like a detent rather than snapping. Reduced motion keeps the label and
/// drops the slide.
struct FloatingTabBar<Tab: Hashable>: View {
    struct Item {
        let tab: Tab
        let title: String
        let symbol: String
        var badge: Int = 0
    }

    let items: [Item]
    @Binding var selection: Tab

    @Namespace private var ns
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items.indices, id: \.self) { i in
                button(items[i])
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 60)
        .background {
            Capsule()
                .fill(.ultraThinMaterial)
                .overlay(Capsule().fill(T.panel.opacity(0.78)))
                .overlay(Capsule().strokeBorder(T.lineStrong, lineWidth: 0.75))
                .shadow(color: .black.opacity(0.55), radius: 22, x: 0, y: 12)
        }
        .environment(\.colorScheme, .dark)
    }

    private func button(_ item: Item) -> some View {
        let active = item.tab == selection
        return Button {
            guard !active else { return }
            Haptics.tick()
            withAnimation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.86)) {
                selection = item.tab
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: item.symbol)
                    .font(.system(size: 17, weight: active ? .semibold : .regular))
                    .foregroundStyle(active ? T.jade : T.faint)
                    .overlay(alignment: .topTrailing) {
                        if item.badge > 0 && !active {
                            Circle()
                                .fill(T.brass)
                                .frame(width: 7, height: 7)
                                .overlay(Circle().strokeBorder(T.panel, lineWidth: 1.5))
                                .offset(x: 4, y: -2)
                        }
                    }
                if active {
                    Text(item.title)
                        .font(F.semibold(13.5))
                        .foregroundStyle(T.jade)
                        .lineLimit(1)
                        .fixedSize()
                        .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .leading)))
                }
            }
            .padding(.horizontal, 14)
            .frame(minWidth: 44, minHeight: 44)
            .background {
                if active {
                    Capsule()
                        .fill(T.panel2)
                        .overlay(Capsule().strokeBorder(T.jade.opacity(0.3), lineWidth: 0.75))
                        .matchedGeometryEffect(id: "active-tab", in: ns)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.pressScale)
        .accessibilityLabel(item.badge > 0 ? "\(item.title), \(item.badge) to review" : item.title)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}
