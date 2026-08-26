import CoreData
import SwiftUI

/// The ledger, and the one screen where you change something.
///
/// Everything else in the app reads; this is where a transaction gets a
/// category, which is what makes every budget and chart downstream correct. So
/// the review backlog is stated rather than hidden behind a toggle, and the
/// categorise flow is two taps from any row.
struct TransactionsView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)],
        animation: .default
    )
    private var transactions: FetchedResults<CDTransaction>

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "name", ascending: true)],
        predicate: NSPredicate(format: "archived == NO")
    )
    private var categories: FetchedResults<CDCategory>

    @State private var searchText = ""
    @State private var showUnreviewedOnly = false
    @State private var editing: CDTransaction?

    private var index: CategoryIndex { CategoryIndex(categories: Array(categories)) }

    private var filtered: [CDTransaction] {
        let idx = index
        let term = searchText.lowercased()
        return transactions.filter { txn in
            if showUnreviewedOnly && txn.reviewed { return false }
            guard !term.isEmpty else { return true }
            return (txn.merchantName ?? txn.name ?? "").lowercased().contains(term)
                || idx.displayName(for: txn).lowercased().contains(term)
        }
    }

    /// Grouped by day. Forty rows each restating their own date is the layout
    /// you write when you don't have a header to put it in.
    private var days: [(day: String, txns: [CDTransaction])] {
        var out: [(String, [CDTransaction])] = []
        for txn in filtered {
            let key = txn.date ?? ""
            if var last = out.last, last.0 == key {
                last.1.append(txn)
                out[out.count - 1] = last
            } else {
                out.append((key, [txn]))
            }
        }
        return out.map { (day: $0.0, txns: $0.1) }
    }

    private var unreviewed: Int { TransactionRepository.unreviewedCount(in: context) }

    var body: some View {
        // The list is its own view rather than inline. SwiftUI's type checker
        // gives up on deeply nested generic builders, and the failure shows up
        // as "unable to type-check in reasonable time" on whichever Xcode is
        // strictest — often CI's, not the one on your desk.
        ledger
        .searchable(text: $searchText, prompt: "Search merchant or category")
        .background(T.ink)
        .scrollContentBackground(.hidden)
        .navigationTitle("Transactions")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Toggle(isOn: $showUnreviewedOnly) {
                    Label("To review", systemImage: "circle.badge.exclamationmark")
                }
                .toggleStyle(.button)
                .disabled(unreviewed == 0 && !showUnreviewedOnly)
            }
        }
        .sheet(item: $editing) { txn in
            CategorizeSheet(txn: txn, categories: Array(categories), index: index)
                .environment(\.managedObjectContext, context)
        }
        .overlay {
            if filtered.isEmpty {
                if searchText.isEmpty && FirstRunImport.storeIsEmpty(context) {
                    EmptyStorePrompt(
                        title: "No transactions yet",
                        detail: "Import budgetr.db to load your ledger."
                    )
                } else {
                    ContentUnavailableView(
                        searchText.isEmpty ? "No transactions yet" : "No results",
                        systemImage: searchText.isEmpty ? "tray" : "magnifyingglass",
                        description: Text(searchText.isEmpty
                            ? "Import budgetr.db to load your ledger."
                            : "Try a different search term.")
                    )
                }
            }
        }
    }

    private var ledger: some View {
        let idx = index
        return List {
            // In the list rather than the navigation bar: navigationSubtitle is
            // macOS-only at this deployment target, and this is information
            // about the data — not window chrome.
            Section {
                Text(subtitle)
                    .font(F.mono(10.5))
                    .foregroundStyle(unreviewed > 0 ? T.brass : T.faint)
                    .listRowBackground(Color.clear)
            }

            ForEach(days, id: \.day) { group in
                Section {
                    ForEach(group.txns, id: \.objectID) { txn in
                        Row(txn: txn, categoryName: idx.displayName(for: txn))
                            .contentShape(Rectangle())
                            .onTapGesture { editing = txn }
                    }
                } header: {
                    Eyebrow(Self.dayLabel(group.day), color: T.muted)
                }
            }
        }
    }

    /// States the size of the list and the size of the backlog, because
    /// "Transactions" alone doesn't say whether there's work to do.
    private var subtitle: String {
        let shown = filtered.count
        let backlog = unreviewed
        if backlog == 0 { return "\(shown) transactions · all reviewed" }
        return "\(shown) transactions · \(backlog) to review"
    }

    /// `2026-08-17` → `Today` / `Yesterday` / `Sun 17 Aug`.
    static func dayLabel(_ raw: String) -> String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: raw) else { return raw }

        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Today" }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        let out = DateFormatter()
        out.dateFormat = cal.isDate(date, equalTo: Date(), toGranularity: .year) ? "EEE d MMM" : "d MMM yyyy"
        return out.string(from: date)
    }
}

// ── Row ──────────────────────────────────────────────────────────────

private struct Row: View {
    @ObservedObject var txn: CDTransaction
    let categoryName: String

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(txn.merchantName ?? txn.name ?? "—")
                    .font(F.body(13.5))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Text(categoryName)
                    if txn.pending {
                        Text("·")
                        Text("pending").foregroundStyle(T.brass)
                    }
                }
                .font(F.mono(10.5))
                .foregroundStyle(T.faint)
            }

            Spacer(minLength: 8)

            // Plaid's convention: positive is money leaving. Inflows are the
            // ones worth colouring, because they're the exception.
            Text(abs(txn.amount).money(txn.isoCurrencyCode ?? "USD"))
                .font(F.mono(13))
                .foregroundStyle(txn.amount > 0 ? T.paper : T.jade)

            if !txn.reviewed {
                Image(systemName: "circle.fill")
                    .font(.system(size: 6))
                    .foregroundStyle(T.brass)
                    .accessibilityLabel("Needs review")
            }
        }
        .padding(.vertical, 2)
    }
}

// ── Categorise ───────────────────────────────────────────────────────

/// One transaction, and the decision to make about it.
private struct CategorizeSheet: View {
    @Environment(\.managedObjectContext) private var context
    @Environment(\.dismiss) private var dismiss

    @ObservedObject var txn: CDTransaction
    let categories: [CDCategory]
    let index: CategoryIndex

    @State private var applyToMerchant = false
    @State private var error: String?

    private var merchant: String { txn.merchantName ?? txn.name ?? "—" }
    private var repo: TransactionRepository { TransactionRepository(context: context) }

    /// Categories grouped the way the web app groups them, so the same category
    /// is in the same place on both.
    private var grouped: [(group: String, items: [CDCategory])] {
        let order = ["spending", "income", "transfer"]
        return order.compactMap { g in
            let items = categories.filter { ($0.group ?? "spending") == g }
            return items.isEmpty ? nil : (group: g, items: items)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(abs(txn.amount).money(txn.isoCurrencyCode ?? "USD"))
                            .font(F.display(30))
                            .foregroundStyle(T.paper)
                        Text(merchant).font(F.medium(15)).foregroundStyle(T.paper)
                        Text(TransactionsView.dayLabel(txn.date ?? ""))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    Toggle(isOn: $applyToMerchant) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Apply to all \(merchant)")
                            Text("Only rows you haven't already decided on")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                ForEach(grouped, id: \.group) { section in
                    Section(section.group.capitalized) {
                        ForEach(section.items, id: \.objectID) { cat in
                            Button {
                                choose(cat)
                            } label: {
                                HStack {
                                    Text(cat.name ?? "—")
                                    Spacer()
                                    if txn.userCategory?.objectID == cat.objectID {
                                        Image(systemName: "checkmark").foregroundStyle(.tint)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                if txn.userCategory != nil {
                    Section {
                        Button("Clear override", role: .destructive) { choose(nil) }
                    } footer: {
                        Text("Falls back to \(index.displayName(for: txn)) from the bank. Stays reviewed — you already made a call.")
                    }
                }
            }
            .navigationTitle("Categorise")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("Couldn't save", isPresented: .constant(error != nil)) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
        }
        .frame(minWidth: 380, minHeight: 480)
    }

    private func choose(_ cat: CDCategory?) {
        do {
            if let cat, applyToMerchant {
                try repo.applyCategoryToMerchant(cat, merchant: merchant)
            }
            try repo.setCategory(cat, on: txn)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        TransactionsView()
            .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
    }
}
