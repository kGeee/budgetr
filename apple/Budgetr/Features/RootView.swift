import CoreData
import SwiftUI

struct ImportAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

/// The app shell, laid out like the web app's: a grouped sidebar over a dark
/// canvas, with the `b.` mark at the top.
///
/// The grouping is the web app's own — Ledger, Planning, Assistant — so moving
/// between the two doesn't mean relearning where anything lives. Sections that
/// aren't built yet are listed and disabled rather than hidden, because a
/// missing nav item reads as "this app can't do that" when the truth is "not
/// yet".
struct RootView: View {
    enum Item: String, CaseIterable, Identifiable {
        case overview, accounts, transactions, categories
        case budgets, recurring
        case review

        var id: String { rawValue }

        var title: String {
            switch self {
            case .overview: return "Overview"
            case .accounts: return "Accounts"
            case .transactions: return "Transactions"
            case .categories: return "Categories"
            case .budgets: return "Budgets"
            case .recurring: return "Recurring"
            case .review: return "Review"
            }
        }

        /// SF Symbols closest to the web sidebar's lucide icons.
        var symbol: String {
            switch self {
            case .overview: return "square.grid.2x2"
            case .accounts: return "building.columns"
            case .transactions: return "arrow.left.arrow.right"
            case .categories: return "tag"
            case .budgets: return "wallet.bifold"
            case .recurring: return "arrow.trianglehead.2.clockwise"
            case .review: return "checkmark.circle"
            }
        }

        var group: String {
            switch self {
            case .overview: return ""
            case .accounts, .transactions, .categories, .recurring: return "Ledger"
            case .budgets: return "Planning"
            case .review: return "Assistant"
            }
        }
    }

    @Environment(\.managedObjectContext) private var context
    @State private var selection: Item? = .overview
    @State private var showingImporter = false
    @State private var importAlert: ImportAlert?

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
            detail
                .background(T.ink)
        }
        .background(T.ink)
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

    private var sidebar: some View {
        List(selection: $selection) {
            BrandMark()
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .padding(.bottom, 6)

            ForEach(groups, id: \.name) { group in
                Section {
                    ForEach(group.items) { item in
                        Label(item.title, systemImage: item.symbol)
                            .font(F.body(13.5))
                            .tag(item)
                    }
                } header: {
                    if !group.name.isEmpty { Eyebrow(group.name) }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("budgetr")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button {
                    showingImporter = true
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
        }
    }
}

/// The `b.` mark — the same italic serif letter and jade dot the desktop app,
/// the DMG and the phone all show.
struct BrandMark: View {
    var size: CGFloat = 30

    var body: some View {
        HStack(spacing: 9) {
            ZStack(alignment: .bottomTrailing) {
                RoundedRectangle(cornerRadius: size * 0.28)
                    .fill(T.panel)
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.28)
                            .strokeBorder(T.brassDim, lineWidth: 1)
                    )
                    .frame(width: size, height: size)

                Text("b")
                    .font(F.display(size * 0.62))
                    .italic()
                    .foregroundStyle(T.paper)
                    .offset(x: -size * 0.18, y: -size * 0.04)

                Circle()
                    .fill(T.jade)
                    .frame(width: size * 0.15, height: size * 0.15)
                    .offset(x: -size * 0.16, y: -size * 0.2)
            }
            .frame(width: size, height: size)

            Text("budgetr")
                .font(F.display(20))
                .foregroundStyle(T.paper)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    RootView()
        .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
}
