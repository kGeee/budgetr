import SwiftUI

/// Top-level navigation, adaptive across platforms:
/// a sidebar split view on macOS / iPad, collapsing to a stack on iPhone.
struct RootView: View {
    enum Section: String, CaseIterable, Identifiable {
        case dashboard = "Dashboard"
        case transactions = "Transactions"
        case budgets = "Budgets"
        var id: String { rawValue }
        var symbol: String {
            switch self {
            case .dashboard: return "chart.line.uptrend.xyaxis"
            case .transactions: return "list.bullet.rectangle"
            case .budgets: return "chart.pie"
            }
        }
    }

    @State private var selection: Section? = .dashboard

    var body: some View {
        NavigationSplitView {
            List(Section.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.symbol)
                    .tag(section)
            }
            .navigationTitle("Budgetr")
        } detail: {
            switch selection ?? .dashboard {
            case .dashboard: DashboardView()
            case .transactions: TransactionsView()
            case .budgets: BudgetsView()
            }
        }
    }
}

#Preview {
    RootView()
        .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
}
