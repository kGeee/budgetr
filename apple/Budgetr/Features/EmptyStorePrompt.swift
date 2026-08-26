import SwiftUI

// MARK: - Environment

private struct TriggerImportKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    /// Opens the system file picker for a budgetr.db ledger.
    var triggerImport: () -> Void {
        get { self[TriggerImportKey.self] }
        set { self[TriggerImportKey.self] = newValue }
    }
}

// MARK: - View

/// First-run empty state with a direct import action.
///
/// Wired from `AppShell` on both iPhone and Mac so an empty store is never a
/// dead end — the user can pick a budgetr.db without hunting for a toolbar item.
struct EmptyStorePrompt: View {
    var title: String = "Nothing here yet"
    var detail: String = "Import your budgetr.db ledger to get started."

    @Environment(\.triggerImport) private var triggerImport

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "tray.and.arrow.down")
                .font(.system(size: 36))
                .foregroundStyle(T.muted)

            VStack(spacing: 6) {
                Text(title)
                    .font(F.medium(18))
                    .foregroundStyle(T.paper)
                Text(detail)
                    .font(F.body(13))
                    .foregroundStyle(T.muted)
                    .multilineTextAlignment(.center)
            }

            Button(action: triggerImport) {
                Label("Import budgetr.db…", systemImage: "square.and.arrow.down")
                    .font(F.semibold(14))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(T.jade)
            .frame(maxWidth: 320)

            platformHint
        }
        .frame(maxWidth: .infinity, minHeight: 320)
        .padding(32)
    }

    @ViewBuilder
    private var platformHint: some View {
        #if os(iOS)
        Text("Tip: drop budgetr.db into Files → On My iPhone → Budgetr and relaunch — it imports automatically.")
            .font(F.mono(10.5))
            .foregroundStyle(T.faint)
            .multilineTextAlignment(.center)
            .padding(.top, 4)
        #else
        Text("Or use Import in the sidebar toolbar.")
            .font(F.mono(10.5))
            .foregroundStyle(T.faint)
            .multilineTextAlignment(.center)
            .padding(.top, 4)
        #endif
    }
}
