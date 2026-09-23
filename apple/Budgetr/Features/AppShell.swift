import SwiftUI

/// Chooses the navigation the platform actually wants.
///
/// Compact iPhone uses a tab bar (Overview, Ledger, Budgets, …) so switching
/// sections is one tap. Regular width (iPad, Mac) keeps the sidebar.
struct AppShell: View {
    @Environment(\.managedObjectContext) private var context
    @State private var firstRun: ImportAlert?
    @State private var showingImporter = false
    @State private var importAlert: ImportAlert?
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        shell
            .environment(\.triggerImport, { showingImporter = true })
            .task { firstRun = FirstRunImport.run(context: context) }
            .fileImporter(
                isPresented: $showingImporter,
                allowedContentTypes: [.init(filenameExtension: "db")!]
            ) { result in
                importAlert = ImportRunner.handle(result, context: context)
            }
            .alert(item: $firstRun) { alert in
                Alert(title: Text(alert.title), message: Text(alert.message))
            }
            .alert(item: $importAlert) { alert in
                Alert(title: Text(alert.title), message: Text(alert.message))
            }
    }

    @ViewBuilder
    private var shell: some View {
        #if os(iOS)
        if sizeClass == .compact {
            PhoneTabs()
        } else {
            RootView()
        }
        #else
        RootView()
        #endif
    }
}

#if os(iOS)

/// Compact phone shell — Overview, Ledger, and Budgets without a sidebar list.
private struct PhoneTabs: View {
    var body: some View {
        TabView {
            tab(DashboardView(), "Overview", "square.grid.2x2")
            tab(TransactionsView(), "Ledger", "arrow.left.arrow.right")
            tab(BudgetsView(), "Budgets", "wallet.bifold")
            tab(ReviewView(), "Review", "checkmark.circle")
            tab(MoreView(), "More", "ellipsis")
        }
        .tint(T.jade)
        .preferredColorScheme(.dark)
    }

    private func tab<V: View>(_ view: V, _ title: String, _ symbol: String) -> some View {
        NavigationStack { view }
            .tabItem { Label(title, systemImage: symbol) }
    }
}

/// Desk destinations that don't fit the tab bar, plus import.
private struct MoreView: View {
    @Environment(\.triggerImport) private var triggerImport

    var body: some View {
        List {
            Section {
                NavigationLink { AccountsView() } label: {
                    Label("Accounts", systemImage: "building.columns")
                }
                NavigationLink { CategoriesView() } label: {
                    Label("Categories", systemImage: "tag")
                }
                NavigationLink { RecurringView() } label: {
                    Label("Recurring", systemImage: "arrow.trianglehead.2.clockwise")
                }
            } header: {
                Eyebrow("Ledger")
            }

            Section {
                Button(action: triggerImport) {
                    Label("Import a ledger…", systemImage: "square.and.arrow.down")
                }
            } header: {
                Eyebrow("Data")
            } footer: {
                Text("Put budgetr.db in Files → On My iPhone → Budgetr, or AirDrop it from your Mac, then open it here.")
                    .font(F.body(11.5))
                    .foregroundStyle(T.faint)
            }
        }
        .navigationTitle("More")
        .background(T.ink)
        .scrollContentBackground(.hidden)
    }
}

#endif
