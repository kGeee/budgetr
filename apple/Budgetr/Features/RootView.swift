import CoreData
import SwiftUI

/// The regular-width shell (iPad, Mac), laid out like the web app's: a grouped
/// sidebar over the dark canvas, with the `b.` mark at the top.
///
/// The grouping is the web app's own — Ledger, Planning, Assistant — so moving
/// between the two doesn't mean relearning where anything lives.
struct RootView: View {
    enum Item: String, CaseIterable, Identifiable {
        case overview, accounts, transactions, categories
        case budgets, recurring
        case review
        case settings

        var id: String { rawValue }

        var title: String {
            switch self {
            case .overview: return "Spending"
            case .accounts: return "Accounts"
            case .transactions: return "Transactions"
            case .categories: return "Categories"
            case .budgets: return "Budgets"
            case .recurring: return "Recurring"
            case .review: return "Review"
            case .settings: return "Settings"
            }
        }

        /// SF Symbols closest to the web sidebar's lucide icons.
        var symbol: String {
            switch self {
            case .overview: return "square.grid.2x2"
            case .accounts: return "building.columns"
            case .transactions: return "arrow.left.arrow.right"
            case .categories: return "tag"
            case .budgets: return "chart.pie"
            case .recurring: return "arrow.triangle.2.circlepath"
            case .review: return "checkmark.circle"
            case .settings: return "gearshape"
            }
        }

        var group: String {
            switch self {
            case .overview: return ""
            case .accounts, .transactions, .categories, .recurring: return "Ledger"
            case .budgets: return "Planning"
            case .review: return "Assistant"
            case .settings: return "App"
            }
        }
    }

    @EnvironmentObject private var app: AppModel
    @State private var selection: Item? = .overview

    @FetchRequest(sortDescriptors: [], predicate: NSPredicate(format: "reviewed == NO"))
    private var unreviewed: FetchedResults<CDTransaction>

    private var groups: [(name: String, items: [Item])] {
        var out: [(String, [Item])] = []
        for item in Item.allCases {
            if var last = out.last, last.0 == item.group {
                last.1.append(item)
                out[out.count - 1] = last
            } else {
                out.append((item.group, [item]))
            }
        }
        return out.map { (name: $0.0, items: $0.1) }
    }

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            NavigationStack {
                detail
            }
            .id(selection)
        }
        .background(T.ink)
        .onChange(of: selection) { _, _ in Haptics.tick() }
    }

    private var sidebar: some View {
        List(selection: $selection) {
            BrandMark()
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .padding(.bottom, 6)

            ForEach(groups, id: \.name) { group in
                Section {
                    ForEach(group.items) { item in
                        Label {
                            Text(item.title).font(F.medium(13.5))
                        } icon: {
                            Image(systemName: item.symbol)
                        }
                        .badge(item == .review ? unreviewed.count : 0)
                        .tag(item)
                    }
                } header: {
                    if !group.name.isEmpty { Eyebrow(group.name) }
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(T.ink)
        .navigationTitle("budgetr")
        .navigationSplitViewColumnWidth(min: 200, ideal: 230)
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button {
                    app.showingImporter = true
                } label: {
                    Label("Import", systemImage: "square.and.arrow.down")
                }
                .help("Import from web/data/budgetr.db")
            }
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch selection ?? .overview {
        case .overview: DashboardView()
        case .accounts: AccountsView()
        case .transactions: TransactionsView()
        case .categories: CategoriesView()
        case .budgets: BudgetsView()
        case .recurring: RecurringView()
        case .review: ReviewView()
        case .settings: SettingsView()
        }
    }
}

#Preview {
    RootView()
        .environmentObject(AppModel())
        .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
}
