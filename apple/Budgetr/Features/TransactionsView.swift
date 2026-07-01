import SwiftUI
import CoreData

struct TransactionsView: View {
    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)],
        animation: .default
    )
    private var transactions: FetchedResults<CDTransaction>

    @State private var searchText = ""
    @State private var showUnreviewedOnly = false

    private var filtered: [CDTransaction] {
        transactions.filter { txn in
            if showUnreviewedOnly && txn.reviewed { return false }
            guard !searchText.isEmpty else { return true }
            let term = searchText.lowercased()
            return (txn.merchantName ?? txn.name ?? "").lowercased().contains(term)
                || (txn.userCategory?.name ?? "").lowercased().contains(term)
        }
    }

    var body: some View {
        List {
            ForEach(filtered, id: \.objectID) { txn in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(txn.merchantName ?? txn.name ?? "—")
                            .font(.body)
                        HStack(spacing: 4) {
                            Text(txn.date ?? "")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let cat = txn.userCategory?.name {
                                Text("·")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(cat)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    Spacer()
                    Text(amountString(txn.amount))
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
        .searchable(text: $searchText, prompt: "Search merchant or category")
        .navigationTitle("Transactions")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Toggle(isOn: $showUnreviewedOnly) {
                    Label("Unreviewed", systemImage: "circle.badge.exclamationmark")
                }
                .toggleStyle(.button)
            }
        }
        .overlay {
            if filtered.isEmpty {
                ContentUnavailableView(
                    searchText.isEmpty ? "No transactions yet" : "No results",
                    systemImage: searchText.isEmpty ? "tray" : "magnifyingglass",
                    description: Text(searchText.isEmpty
                        ? "Import budgetr.db or run a sync."
                        : "Try a different search term.")
                )
            }
        }
    }

    private func amountString(_ amount: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        return formatter.string(from: NSNumber(value: abs(amount))) ?? "\(amount)"
    }
}
