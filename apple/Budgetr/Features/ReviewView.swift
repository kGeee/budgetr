import CoreData
import SwiftUI

/// The review queue — one transaction at a time.
///
/// A phone-shaped idea that works just as well here: browsing a list is how you
/// avoid a backlog, and being handed one row with the decision in front of you
/// is how you clear it. Same write path as the ledger, so a decision made here
/// shows up there immediately.
struct ReviewView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)],
        predicate: NSPredicate(format: "reviewed == NO")
    )
    private var queue: FetchedResults<CDTransaction>

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "name", ascending: true)],
        predicate: NSPredicate(format: "archived == NO AND group == 'spending'")
    )
    private var categories: FetchedResults<CDCategory>

    @State private var error: String?

    private var current: CDTransaction? { queue.first }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let txn = current {
                    Eyebrow("\(queue.count) left to review")
                    card(txn)
                } else {
                    ContentUnavailableView(
                        "Nothing to review",
                        systemImage: "checkmark.circle",
                        description: Text("Every transaction has a category.")
                    )
                    .padding(.top, 80)
                }
            }
            .padding(20)
        }
        .background(T.ink)
        .navigationTitle("Review")
        .alert("Couldn't save", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: { Text(error ?? "") }
    }

    private func card(_ txn: CDTransaction) -> some View {
        let idx = CategoryIndex(categories: Array(categories))
        return VStack(alignment: .leading, spacing: 16) {
            Panel {
                VStack(alignment: .leading, spacing: 6) {
                    Text(abs(txn.amount).money(txn.isoCurrencyCode ?? "USD"))
                        .font(F.display(40))
                        .foregroundStyle(txn.amount > 0 ? T.paper : T.jade)
                    Text(txn.merchantName ?? txn.name ?? "—")
                        .font(F.medium(15))
                        .foregroundStyle(T.paper)
                    Text([txn.date, txn.account?.name, idx.displayName(for: txn)]
                            .compactMap { $0 }.joined(separator: " · "))
                        .font(F.mono(11))
                        .foregroundStyle(T.faint)
                }
            }

            TitledPanel("File it as") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                    ForEach(categories, id: \.objectID) { cat in
                        Button {
                            assign(cat, to: txn)
                        } label: {
                            Text(cat.name ?? "—")
                                .font(F.body(12.5))
                                .foregroundStyle(T.paper)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 9)
                                .background(T.panel2, in: RoundedRectangle(cornerRadius: 9))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Button {
                assign(nil, to: txn)   // keep the bank's guess, just stop asking
            } label: {
                Text("Looks right — skip")
                    .font(F.body(12.5))
                    .foregroundStyle(T.muted)
            }
            .buttonStyle(.plain)
        }
    }

    private func assign(_ cat: CDCategory?, to txn: CDTransaction) {
        do {
            let repo = TransactionRepository(context: context)
            if let cat {
                try repo.setCategory(cat, on: txn)
            } else {
                try repo.setReviewed(true, on: txn)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
