import SwiftUI
import CoreData

/// Transactions list (Phase 2). Mirrors `web/app/transactions/page.tsx`:
/// recent transactions with review status; in-line categorization comes next.
struct TransactionsView: View {
    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)],
        animation: .default
    )
    private var transactions: FetchedResults<CDTransaction>

    var body: some View {
        List {
            ForEach(transactions, id: \.objectID) { txn in
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(txn.merchantName ?? txn.name ?? "—")
                        .font(.body)
                    Text(txn.date ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(amountString(txn.amount))
                    // Plaid convention: positive = money out (spend).
                    .foregroundStyle(txn.amount > 0 ? Color.primary : Color.green)
                    .monospacedDigit()
                if !txn.reviewed {
                    Image(systemName: "circle.badge.exclamationmark")
                        .foregroundStyle(.orange)
                        .help("Needs review")
                }
            }
            }
        }
        .navigationTitle("Transactions")
        .overlay {
            if transactions.isEmpty {
                ContentUnavailableView("No transactions yet",
                                       systemImage: "tray",
                                       description: Text("Run a sync or import the existing budgetr.db."))
            }
        }
    }

    private func amountString(_ amount: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        return formatter.string(from: NSNumber(value: abs(amount))) ?? "\(amount)"
    }
}
