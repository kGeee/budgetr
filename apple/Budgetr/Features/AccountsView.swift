import SwiftUI
import CoreData

struct AccountsView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(
        sortDescriptors: [
            NSSortDescriptor(key: "item.institutionName", ascending: true),
            NSSortDescriptor(key: "name", ascending: true)
        ],
        animation: .default
    )
    private var accounts: FetchedResults<CDAccount>

    var body: some View {
        List {
            ForEach(groupedAccounts, id: \.key) { group in
                Section(header: Text(group.key)) {
                    ForEach(group.value, id: \.objectID) { account in
                        AccountRow(account: account, context: context)
                    }
                }
            }
        }
        .navigationTitle("Accounts")
        .overlay {
            if accounts.isEmpty {
                ContentUnavailableView(
                    "No accounts yet",
                    systemImage: "creditcard",
                    description: Text("Link an institution to get started.")
                )
            }
        }
    }

    private var groupedAccounts: [(key: String, value: [CDAccount])] {
        let grouped = Dictionary(grouping: accounts) { account in
            account.item?.institutionName ?? "Unknown"
        }
        return grouped.sorted { $0.key < $1.key }
    }
}

struct AccountRow: View {
    let account: CDAccount
    let context: NSManagedObjectContext

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(account.name ?? account.officialName ?? "—")
                        .font(.body)
                        .fontWeight(.semibold)

                    if account.excluded {
                        Text("Excluded")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.2))
                            .cornerRadius(4)
                    }
                }

                HStack(spacing: 8) {
                    if let mask = account.mask {
                        Text("•••• \(mask)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }

                    if let type = account.type {
                        let displayType = typeDisplay(type, subtype: account.subtype)
                        Text(displayType)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                let balance = account.currentBalance?.doubleValue ?? 0
                Text(balanceString(balance, currency: account.isoCurrencyCode ?? "USD", isLiability: isLiability(account.type)))
                    .font(.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(balanceColor(balance, isLiability: isLiability(account.type)))
                    .monospacedDigit()

                Button(action: { toggleExcluded(account) }) {
                    Image(systemName: account.excluded ? "eye.slash.fill" : "eye.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help(account.excluded ? "Include account" : "Exclude account")
            }
        }
        .padding(.vertical, 2)
    }

    private func typeDisplay(_ type: String, subtype: String?) -> String {
        let typeLabel: String
        switch type.lowercased() {
        case "depository":
            typeLabel = subtype?.lowercased() == "checking" ? "Checking" : "Savings"
        case "credit":
            typeLabel = "Credit Card"
        case "investment":
            typeLabel = "Investment"
        case "loan":
            typeLabel = "Loan"
        default:
            typeLabel = type
        }
        return typeLabel
    }

    private func isLiability(_ type: String?) -> Bool {
        guard let type = type else { return false }
        let lower = type.lowercased()
        return lower == "credit" || lower == "loan"
    }

    private func balanceString(_ balance: Double, currency: String, isLiability: Bool) -> String {
        let displayBalance = isLiability ? -balance : balance
        return displayBalance.formatted(.currency(code: currency))
    }

    private func balanceColor(_ balance: Double, isLiability: Bool) -> Color {
        if isLiability {
            return balance > 0 ? .red : .primary
        }
        return .primary
    }

    private func toggleExcluded(_ account: CDAccount) {
        account.excluded.toggle()
        do {
            try context.save()
        } catch {
            print("Failed to save excluded toggle: \(error)")
        }
    }
}

#Preview {
    let container = NSPersistentContainer(name: "Model")
    container.loadPersistentStores { _, error in
        if let error = error {
            print("Failed to load persistent stores: \(error)")
        }
    }

    return AccountsView()
        .environment(\.managedObjectContext, container.viewContext)
}
