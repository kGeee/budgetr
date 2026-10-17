import CoreData
import SwiftUI
import UniformTypeIdentifiers

struct ImportAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

/// App-wide actions any screen can reach for: open the ledger importer, load or
/// remove the sample ledger, and say how that went. One instance, owned by the
/// shell, so the importer and its alert are wired exactly once for both
/// platforms instead of once per shell.
final class AppModel: ObservableObject {
    @Published var showingImporter = false
    @Published var alert: ImportAlert?
    @Published var confirmingErase = false

    func importLedger(_ result: Result<URL, Error>, context: NSManagedObjectContext) {
        // A real ledger replaces the sample one rather than mixing into it —
        // invented rows sitting beside real ones would be worse than either.
        if SampleData.isLoaded, case .success = result {
            try? DataReset.eraseAll(in: context)
        }
        let outcome = ImportRunner.handle(result, context: context)
        if outcome.title == "Import complete" { Haptics.success() } else { Haptics.error() }
        alert = outcome
    }

    func loadSample(context: NSManagedObjectContext) {
        guard FirstRunImport.storeIsEmpty(context) else {
            Haptics.warning()
            alert = ImportAlert(
                title: "You already have a ledger",
                message: "Sample data only loads into an empty app, so it can never mix with your own. Erase this one first from Settings."
            )
            return
        }
        do {
            try SampleData.load(into: context)
            Haptics.success()
        } catch {
            Haptics.error()
            alert = ImportAlert(title: "Couldn't load sample data", message: error.localizedDescription)
        }
    }

    func eraseAll(context: NSManagedObjectContext) {
        do {
            try DataReset.eraseAll(in: context)
            Haptics.warning()
        } catch {
            Haptics.error()
            alert = ImportAlert(title: "Couldn't erase", message: error.localizedDescription)
        }
    }
}

/// Chooses the navigation the platform actually wants.
///
/// A `NavigationSplitView` on an iPhone collapses into a stack whose root is a
/// list of section names — so every visit starts by picking a destination, and
/// the back button says "budgetr" rather than where you came from. That is a
/// desk paradigm running on a phone.
///
/// On compact width the app is the companion's floating pill tab bar instead,
/// so switching sections costs one tap and the current one is always visible.
/// Regular width (iPad, Mac) keeps the sidebar, which is right there.
///
/// On iOS, pairing with the Mac comes first: a paired phone shows the Mac's
/// published summary; an unpaired one with no ledger opens on the pairing
/// screen, with the .db import and sample data as the quieter ways in.
struct AppShell: View {
    @Environment(\.managedObjectContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var app = AppModel()
    @StateObject private var companion = CompanionStore()
    @AppStorage(SampleData.flagKey) private var sampleLoaded = false
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    /// One row is enough to know whether there's a ledger at all.
    @FetchRequest private var anyTransaction: FetchedResults<CDTransaction>

    init() {
        let request = NSFetchRequest<CDTransaction>(entityName: "CDTransaction")
        request.sortDescriptors = []
        request.fetchLimit = 1
        _anyTransaction = FetchRequest(fetchRequest: request)
    }

    private static let ledgerType = UTType(filenameExtension: "db") ?? .data

    var body: some View {
        shell
            .safeAreaInset(edge: .top, spacing: 0) {
                if sampleLoaded && !companion.isPaired {
                    SampleRibbon { app.confirmingErase = true }
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(M.settle, value: sampleLoaded)
            .animation(M.settle, value: companion.phase)
            .environmentObject(app)
            .environmentObject(companion)
            .tint(T.jade)
            .preferredColorScheme(.dark)
            .fileImporter(isPresented: $app.showingImporter, allowedContentTypes: [Self.ledgerType]) { result in
                app.importLedger(result, context: context)
            }
            .alert(item: $app.alert) { alert in
                Alert(title: Text(alert.title), message: Text(alert.message))
            }
            .confirmationDialog(
                sampleLoaded ? "Remove the sample data?" : "Erase everything on this device?",
                isPresented: $app.confirmingErase,
                titleVisibility: .visible
            ) {
                Button(sampleLoaded ? "Remove sample data" : "Erase all data", role: .destructive) {
                    app.eraseAll(context: context)
                }
            } message: {
                Text(sampleLoaded
                     ? "The app goes back to empty, ready for your own ledger."
                     : "Transactions, accounts, budgets and categories are removed from this device. Your ledger file is untouched.")
            }
            .task {
                if let outcome = FirstRunImport.run(context: context) { app.alert = outcome }
                await companion.refresh()
            }
            .onChange(of: scenePhase) { _, phase in
                // Back in the foreground is when the numbers are most likely
                // stale — the Mac has probably synced since.
                if phase == .active { Task { await companion.refresh() } }
            }
    }

    @ViewBuilder
    private var shell: some View {
        #if os(iOS)
        switch companion.phase {
        case .paired:
            CompanionTabs()
        case .updateRequired:
            NavigationStack { CompanionUpdateRequiredView() }
        case .unpaired:
            if anyTransaction.isEmpty {
                NavigationStack { PairingView() }
            } else if sizeClass == .compact {
                PhoneTabs()
            } else {
                RootView()
            }
        }
        #else
        RootView()
        #endif
    }
}

#if os(iOS)

private enum PhoneTab: Hashable {
    case overview, ledger, review, budgets, more
}

/// The phone shell: five destinations under the floating pill.
///
/// A real `TabView` underneath (each tab keeps its own navigation stack and
/// scroll position), with the system bar hidden and the pill drawn over it.
private struct PhoneTabs: View {
    @State private var tab: PhoneTab = .overview

    @FetchRequest(sortDescriptors: [], predicate: NSPredicate(format: "reviewed == NO"))
    private var unreviewed: FetchedResults<CDTransaction>

    private var items: [FloatingTabBar<PhoneTab>.Item] {
        [
            .init(tab: .overview, title: "Spending", symbol: "square.grid.2x2"),
            .init(tab: .ledger, title: "Ledger", symbol: "arrow.left.arrow.right"),
            .init(tab: .review, title: "Review", symbol: "checkmark.circle", badge: unreviewed.count),
            .init(tab: .budgets, title: "Budgets", symbol: "chart.pie"),
            .init(tab: .more, title: "More", symbol: "ellipsis"),
        ]
    }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { DashboardView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(PhoneTab.overview)
            NavigationStack { TransactionsView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(PhoneTab.ledger)
            NavigationStack { ReviewView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(PhoneTab.review)
            NavigationStack { BudgetsView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(PhoneTab.budgets)
            NavigationStack { SettingsView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(PhoneTab.more)
        }
        .environment(\.chromeClearance, 84)
        .overlay(alignment: .bottom) {
            FloatingTabBar(items: items, selection: $tab)
            .padding(.bottom, 2)
            .ignoresSafeArea(.keyboard)
        }
    }
}


private enum CompanionTab: Hashable {
    case spending, activity, budgets, holdings, more
}

/// The paired phone: the Expo companion's tabs, under the same floating pill.
private struct CompanionTabs: View {
    @EnvironmentObject private var companion: CompanionStore
    @State private var tab: CompanionTab = .spending

    private var items: [FloatingTabBar<CompanionTab>.Item] {
        [
            .init(tab: .spending, title: "Spending", symbol: "square.grid.2x2"),
            .init(tab: .activity, title: "Activity", symbol: "arrow.left.arrow.right"),
            .init(tab: .budgets, title: "Budgets", symbol: "chart.pie"),
            .init(tab: .holdings, title: "Holdings", symbol: "chart.line.uptrend.xyaxis"),
            .init(tab: .more, title: "More", symbol: "ellipsis", badge: companion.syncError == nil ? 0 : 1),
        ]
    }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { CompanionSpendingView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(CompanionTab.spending)
            NavigationStack { CompanionActivityView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(CompanionTab.activity)
            NavigationStack { CompanionBudgetsView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(CompanionTab.budgets)
            NavigationStack { CompanionHoldingsView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(CompanionTab.holdings)
            NavigationStack { CompanionSettingsView() }
                .toolbar(.hidden, for: .tabBar)
                .tag(CompanionTab.more)
        }
        .environment(\.chromeClearance, 84)
        .overlay(alignment: .bottom) {
            FloatingTabBar(items: items, selection: $tab)
                .padding(.bottom, 2)
                .ignoresSafeArea(.keyboard)
        }
    }
}

#endif
