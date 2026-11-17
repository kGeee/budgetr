import CoreData
import SwiftUI

/// Accounts, grouped by institution — the web app's layout.
///
/// It leads with the net position rather than a list, because "what am I worth"
/// is the question, and the per-account rows are the working behind it. Cards
/// and loans are held as positive balances (Plaid's convention), so they are
/// subtracted here and shown in coral.
struct AccountsView: View {
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

    /// Balance by kind, for the allocation bar under the hero.
    private var mix: [(kind: String, value: Double, color: Color)] {
        let kinds = ["depository", "investment", "credit", "loan"]
        let colors: [String: Color] = ["depository": T.jade, "investment": T.blue, "credit": T.coral, "loan": T.brass]
        return kinds.compactMap { k in
            let v = accounts.filter { ($0.type ?? "") == k }.reduce(0) { $0 + $1.balance }
            return v > 0 ? (kind: Self.typeLabel(k), value: v, color: colors[k] ?? T.muted) : nil
        }
    }

    var body: some View {
        BScreen("Accounts", eyebrow: "Net position · \(accounts.count) accounts") {
            if accounts.isEmpty {
                Card {
                    EmptyState(symbol: "building.columns", title: "No accounts yet", message: "Import budgetr.db to load them.")
                }
                .rise(0)
            } else {
                header.rise(0)
                ForEach(Array(institutions.enumerated()), id: \.element.id) { i, inst in
                    institutionCard(inst).rise(i + 1)
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            AnimatedMoney(value: net, font: F.display(44))
            HStack(spacing: 6) {
                Text(assets.moneyCompact()).foregroundStyle(T.jade)
                Text("owned against").foregroundStyle(T.muted)
                Text(debts.moneyCompact()).foregroundStyle(T.coral)
                Text("owed").foregroundStyle(T.muted)
            }
            .font(F.body(13))

            let total = mix.reduce(0) { $0 + $1.value }
            if total > 0 {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        ForEach(mix, id: \.kind) { slice in
                            Capsule()
                                .fill(slice.color)
                                .frame(width: max(4, (geo.size.width - CGFloat(mix.count - 1) * 2) * slice.value / total))
                        }
                    }
                }
                .frame(height: 6)

                HStack(spacing: 12) {
                    ForEach(mix, id: \.kind) { slice in
                        HStack(spacing: 5) {
                            Circle().fill(slice.color).frame(width: 6, height: 6)
                            Text(slice.kind).font(F.body(11)).foregroundStyle(T.muted)
                        }
                    }
                }
            }
        }
    }

    private func institutionCard(_ inst: Institution) -> some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    // The institution's initial, in the web app's brass tile.
                    Text(String(inst.name.prefix(1)))
                        .font(F.display(14))
                        .foregroundStyle(T.brass)
                        .frame(width: 30, height: 30)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(T.panel2)
                                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(T.brassDim.opacity(0.5), lineWidth: 0.75))
                        )

                    Text(inst.name).font(F.semibold(14.5)).foregroundStyle(T.paper)
                    Spacer()
                    Text(inst.subtotal.money())
                        .font(F.mono(13))
                        .foregroundStyle(inst.subtotal < 0 ? T.coral : T.muted)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .overlay(alignment: .bottom) { Hairline() }

                ForEach(Array(inst.accounts.enumerated()), id: \.element.objectID) { i, account in
                    HStack(spacing: 12) {
                        Image(systemName: Self.typeSymbol(account.type))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(account.isLiability ? T.coral : T.brass)
                            .frame(width: 26, height: 26)
                            .background(Circle().fill((account.isLiability ? T.coral : T.brass).opacity(0.12)))
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 5) {
                                Text(account.name ?? "—").font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                                if let mask = account.mask {
                                    Text("••\(mask)").font(F.mono(10.5)).foregroundStyle(T.faint)
                                }
                            }
                            Text(Self.typeLabel(account.type))
                                .font(F.body(11))
                                .foregroundStyle(T.faint)
                        }
                        Spacer()
                        Text((account.isLiability ? "-" : "") + account.balance.money(account.isoCurrencyCode ?? "USD"))
                            .font(F.mono(13.5))
                            .foregroundStyle(account.isLiability ? T.coral : T.paper)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 54) } }
                    .accessibilityElement(children: .combine)
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
        default: return raw?.capitalized ?? "Other"
        }
    }

    static func typeSymbol(_ raw: String?) -> String {
        switch raw {
        case "depository": return "banknote"
        case "credit": return "creditcard"
        case "investment": return "chart.line.uptrend.xyaxis"
        case "loan": return "building.columns"
        default: return "circle.dashed"
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
