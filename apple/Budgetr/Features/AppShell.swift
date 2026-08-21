import SwiftUI

/// Chooses the navigation the platform actually wants.
///
/// A `NavigationSplitView` on an iPhone collapses into a stack whose root is a
/// list of section names — so every visit starts by picking a destination, and
/// the back button says "budgetr" rather than where you came from. That is a
/// desk paradigm running on a phone.
///
/// On compact width the app is a tab bar instead, the same five-ish
/// destinations the Expo companion uses, so switching sections costs one tap and
/// the current one is always visible. Regular width (iPad, Mac) keeps the
/// sidebar, which is right there.
struct AppShell: View {
    @Environment(\.managedObjectContext) private var context
    @State private var firstRun: ImportAlert?
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        shell
            .task { firstRun = FirstRunImport.run(context: context) }
            .alert(item: $firstRun) { alert in
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

/// The phone shell: five destinations, the rest behind "More".
///
/// Five is what a tab bar carries before it starts hiding things, so the four
/// you reach for plus a home for everything else — rather than seven tabs with
/// two of them permanently truncated.
private struct PhoneTabs: View {
    @Environment(\.managedObjectContext) private var context
    @State private var showingImporter = false
    @State private var importAlert: ImportAlert?

    var body: some View {
        TabView {
            tab(DashboardView(), "Overview", "square.grid.2x2")
            tab(TransactionsView(), "Ledger", "arrow.left.arrow.right")
            tab(ReviewView(), "Review", "checkmark.circle")
            tab(BudgetsView(), "Budgets", "wallet.bifold")
            tab(MoreView(showingImporter: $showingImporter), "More", "ellipsis")
        }
        .tint(T.jade)
        .preferredColorScheme(.dark)
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [.init(filenameExtension: "db")!]
        ) { result in
            importAlert = ImportRunner.handle(result, context: context)
        }
        .alert(item: $importAlert) { alert in
            Alert(title: Text(alert.title), message: Text(alert.message))
        }
    }

    private func tab<V: View>(_ view: V, _ title: String, _ symbol: String) -> some View {
        NavigationStack { view }
            .tabItem { Label(title, systemImage: symbol) }
    }
}

/// Everything a tab bar can't hold, plus the import path.
private struct MoreView: View {
    @Binding var showingImporter: Bool

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
                Button {
                    showingImporter = true
                } label: {
                    Label("Import a ledger…", systemImage: "square.and.arrow.down")
                }
            } header: {
                Eyebrow("Data")
            } footer: {
                // The Mac reads budgetr.db off disk. A phone has no such file, so
                // it has to arrive — AirDropped, saved from Files, or dropped
                // into the app's folder over a cable. Saying which is the
                // difference between a usable screen and a dead end.
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
