import CoreData
import SwiftUI

/// Accounts, grouped by institution — the web app's layout.
///
/// It leads with the net position rather than a list, because "what am I worth"
/// is the question, and the per-account rows are the working behind it. Cards
/// and loans are held as positive balances (Plaid's convention), so they are
/// subtracted here and shown in coral.
struct AccountsView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "name", ascending: true)])
    private var accounts: FetchedResults<CDAccount>

    private struct Institution: Identifiable {
        let id: String
        let name: String
        let accounts: [CDAccount]
        let subtotal: Double
    }

    private var institutions: [Institution] {
        var buckets: [String: [CDAccount]] = [:]
        for a in accounts {
            buckets[a.item?.institutionName ?? "Other", default: []].append(a)
        }
        return buckets
            .map { name, list in
                Institution(id: name, name: name, accounts: list, subtotal: list.reduce(0) { $0 + $1.signedBalance })
            }
            .sorted { abs($0.subtotal) > abs($1.subtotal) }
    }

    private var net: Double { accounts.reduce(0) { $0 + $1.signedBalance } }
    private var assets: Double { accounts.filter { !$0.isLiability }.reduce(0) { $0 + $1.balance } }
    private var debts: Double { accounts.filter(\.isLiability).reduce(0) { $0 + $1.balance } }

    var body: some View {
        ScrollView {
            if accounts.isEmpty {
                if FirstRunImport.storeIsEmpty(context) {
                    EmptyStorePrompt(
                        title: "No accounts yet",
                        detail: "Import budgetr.db to load your linked accounts."
                    )
                } else {
                    ContentUnavailableView(
                        "No accounts yet",
                        systemImage: "building.columns",
                        description: Text("Import budgetr.db to load them.")
                    )
                    .padding(.top, 80)
                }
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    ForEach(institutions) { inst in
                        institutionCard(inst)
                    }
                }
                .padding(20)
            }
        }
        .background(T.ink)
        .navigationTitle("Accounts")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow("Net position · \(accounts.count) accounts")
            Text(net.money())
                .font(F.display(40))
                .foregroundStyle(T.paper)
            HStack(spacing: 6) {
                Text(assets.money()).foregroundStyle(T.jade)
                Text("owned against").foregroundStyle(T.muted)
                Text(debts.money()).foregroundStyle(T.coral)
                Text("owed").foregroundStyle(T.muted)
            }
            .font(F.body(13))
        }
    }

    private func institutionCard(_ inst: Institution) -> some View {
        Panel(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    // The institution's initial, in the web app's brass tile.
                    Text(String(inst.name.prefix(1)))
                        .font(F.display(13))
                        .foregroundStyle(T.brass)
                        .frame(width: 26, height: 26)
                        .background(T.panel2, in: RoundedRectangle(cornerRadius: 7))

                    Text(inst.name).font(F.medium(14)).foregroundStyle(T.paper)
                    Spacer()
                    Text(inst.subtotal.money()).font(F.mono(13)).foregroundStyle(T.muted)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) { Rectangle().fill(T.line).frame(height: 1) }

                ForEach(inst.accounts, id: \.objectID) { account in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 5) {
                                Text(account.name ?? "—").font(F.body(13.5)).foregroundStyle(T.paper)
                                if let mask = account.mask {
                                    Text("••\(mask)").font(F.mono(10.5)).foregroundStyle(T.faint)
                                }
                            }
                            Text(Self.typeLabel(account.type))
                                .font(F.mono(10))
                                .foregroundStyle(T.brass)
                        }
                        Spacer()
                        Text(account.balance.money(account.isoCurrencyCode ?? "USD"))
                            .font(F.mono(13))
                            .foregroundStyle(account.isLiability ? T.coral : T.paper)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                }
            }
        }
    }

    static func typeLabel(_ raw: String?) -> String {
        switch raw {
        case "depository": return "Cash"
        case "credit": return "Credit"
        case "investment": return "Investments"
        case "loan": return "Loans"
        default: return raw ?? "Other"
        }
    }
}

extension CDAccount {
    /// Plaid holds card and loan balances as positive numbers — what you owe,
    /// not what you have. Everything summing a net position has to flip them.
    var isLiability: Bool { type == "credit" || type == "loan" }

    var balance: Double { currentBalance?.doubleValue ?? 0 }

    var signedBalance: Double { isLiability ? -balance : balance }
}
