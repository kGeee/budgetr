import SwiftUI
import CoreData

struct ImportAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

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

    @Environment(\.managedObjectContext) private var context
    @State private var selection: Section? = .dashboard
    @State private var showingImporter = false
    @State private var importAlert: ImportAlert?

    var body: some View {
        NavigationSplitView {
            List(Section.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.symbol)
                    .tag(section)
            }
            .navigationTitle("Budgetr")
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    Button {
                        showingImporter = true
                    } label: {
                        Label("Import", systemImage: "square.and.arrow.down")
                    }
                }
            }
        } detail: {
            switch selection ?? .dashboard {
            case .dashboard: DashboardView()
            case .transactions: TransactionsView()
            case .budgets: BudgetsView()
            }
        }
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [.init(filenameExtension: "db")!]
        ) { result in
            switch result {
            case .success(let url):
                Task {
                    do {
                        try ImportController.run(url: url, context: context)
                        importAlert = ImportAlert(title: "Import complete", message: "Data has been loaded into the app.")
                    } catch ImportError.cannotOpenDatabase {
                        importAlert = ImportAlert(title: "Import failed", message: "Could not open the selected database file.")
                    } catch ImportError.saveFailed(let error) {
                        importAlert = ImportAlert(title: "Import failed", message: error.localizedDescription)
                    } catch {
                        importAlert = ImportAlert(title: "Import failed", message: error.localizedDescription)
                    }
                }
            case .failure(let error):
                importAlert = ImportAlert(title: "Could not open file", message: error.localizedDescription)
            }
        }
        .alert(item: $importAlert) { alert in
            Alert(title: Text(alert.title), message: Text(alert.message))
        }
    }
}

#Preview {
    RootView()
        .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
}
