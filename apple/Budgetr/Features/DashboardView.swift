import SwiftUI
import CoreData

/// Dashboard placeholder for Phase 2. Real version renders net-worth, monthly
/// cashflow, category breakdown, top budgets, upcoming bills, and the review
/// inbox — using Swift Charts (the native replacement for Recharts).
struct DashboardView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)])
    private var transactions: FetchedResults<CDTransaction>

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Dashboard")
                    .font(.largeTitle.bold())

                GroupBox("Sync status") {
                    Text("\(transactions.count) transactions in the local store.")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                GroupBox("Next up (Phase 2)") {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Net worth chart (Swift Charts)", systemImage: "circle")
                        Label("Monthly cashflow", systemImage: "circle")
                        Label("Spending by category (30d)", systemImage: "circle")
                        Label("Budget summary + pace", systemImage: "circle")
                    }
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding()
        }
        .navigationTitle("Dashboard")
    }
}
