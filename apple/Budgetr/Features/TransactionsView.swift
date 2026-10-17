import CoreData
import SwiftUI

/// The ledger, and the one screen where you change something.
///
/// Everything else in the app reads; this is where a transaction gets a
/// category, which is what makes every budget and chart downstream correct. So
/// the review backlog is stated rather than hidden, the filter is one tap, and
/// categorising is a swipe or a tap from any row.
struct TransactionsView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)],
        animation: .default
    )
    private var transactions: FetchedResults<CDTransaction>

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "sortOrder", ascending: true)],
        predicate: NSPredicate(format: "archived == NO")
    )
    private var categories: FetchedResults<CDCategory>

    @State private var searchText = ""
    @State private var filter: Filter = .all
    @State private var editing: CDTransaction?
    @State private var tracking = ScrollTracking()
    @Environment(\.chromeClearance) private var clearance

    enum Filter: Hashable { case all, review, income }

    private var index: CategoryIndex { CategoryIndex(categories: Array(categories)) }

    private var filtered: [CDTransaction] {
        let idx = index
        let term = searchText.lowercased()
        return transactions.filter { txn in
            switch filter {
            case .all: break
            case .review: if txn.reviewed { return false }
            case .income: if txn.amount >= 0 { return false }
            }
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

    private var unreviewed: Int { transactions.reduce(0) { $0 + ($1.reviewed ? 0 : 1) } }

    var body: some View {
        // The list is its own view rather than inline. SwiftUI's type checker
        // gives up on deeply nested generic builders, and the failure shows up
        // as "unable to type-check in reasonable time" on whichever Xcode is
        // strictest — often CI's, not the one on your desk.
        ledger
            .searchable(text: $searchText, prompt: "Search merchant or category")
            .scrollContentBackground(.hidden)
            .background(AuroraBackground())
            .navigationTitle("Ledger")
            .compactHeader(title: "Ledger", visible: tracking.collapsed)
            .onPreferenceChange(TitleOffsetKey.self) { tracking.update($0) }
            .sheet(item: $editing) { txn in
                CategorizeSheet(txn: txn, categories: Array(categories), index: index)
                    .environment(\.managedObjectContext, context)
            }
    }

    private var ledger: some View {
        let idx = index
        let styles = CategoryStyles(categories: Array(categories))
        let groups = days
        return List {
            Section {
                VStack(alignment: .leading, spacing: 14) {
                    PageHead(title: "Ledger", eyebrow: subtitle) { EmptyView() }
                        .background(TitleOffsetReader())
                    Segmented(
                        options: [("All", Filter.all), ("To review", Filter.review), ("Income", Filter.income)],
                        selection: $filter
                    )
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 6, leading: 18, bottom: 6, trailing: 18))
            }

            if groups.isEmpty {
                Section {
                    emptyState
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            }

            ForEach(groups, id: \.day) { group in
                Section {
                    ForEach(group.txns, id: \.objectID) { txn in
                        Row(
                            txn: txn,
                            categoryName: idx.displayName(for: txn),
                            icon: styles.icon(idx.resolvedId(for: txn)),
                            color: styles.color(idx.resolvedId(for: txn))
                        )
                        .contentShape(Rectangle())
                        .onTapGesture {
                            Haptics.tap()
                            editing = txn
                        }
                        .listRowBackground(T.panel)
                        .listRowSeparatorTint(T.line)
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            Button {
                                toggleReviewed(txn)
                            } label: {
                                Label(txn.reviewed ? "Unreview" : "Reviewed",
                                      systemImage: txn.reviewed ? "arrow.uturn.backward" : "checkmark")
                            }
                            .tint(txn.reviewed ? T.brassDim : T.jadeDeep)
                        }
                        .swipeActions(edge: .trailing) {
                            Button {
                                Haptics.tap()
                                editing = txn
                            } label: {
                                Label("Categorise", systemImage: "tag")
                            }
                            .tint(T.blue.opacity(0.7))
                        }
                    }
                } header: {
                    DayHeader(day: group.day, txns: group.txns)
                }
            }

            Color.clear
                .frame(height: clearance)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        .listSectionSpacing(14)
        #else
        .listStyle(.inset)
        #endif
    }

    @ViewBuilder
    private var emptyState: some View {
        if transactions.isEmpty {
            EmptyState(symbol: "tray", title: "No transactions yet", message: "Import budgetr.db from More, or load the sample ledger to look around.")
        } else if !searchText.isEmpty {
            EmptyState(symbol: "magnifyingglass", title: "No results", message: "Nothing matches “\(searchText)”.")
        } else if filter == .review {
            EmptyState(symbol: "checkmark.seal", title: "All reviewed", message: "Every transaction has a decision on it.")
        } else {
            EmptyState(symbol: "line.3.horizontal.decrease", title: "Nothing here", message: "No transactions match this filter.")
        }
    }

    /// States the size of the list and the size of the backlog, because
    /// "Ledger" alone doesn't say whether there's work to do.
    private var subtitle: String {
        let shown = filtered.count
        let backlog = unreviewed
        if backlog == 0 { return "\(shown) transactions · all reviewed" }
        return "\(shown) transactions · \(backlog) to review"
    }

    private func toggleReviewed(_ txn: CDTransaction) {
        let next = !txn.reviewed
        try? TransactionRepository(context: context).setReviewed(next, on: txn)
        if next { Haptics.success() } else { Haptics.tick() }
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

// ── Pieces ───────────────────────────────────────────────────────────

/// The day, and what left the account on it.
private struct DayHeader: View {
    let day: String
    let txns: [CDTransaction]

    var body: some View {
        let out = txns.reduce(0) { $0 + max(0, $1.amount) }
        HStack {
            Eyebrow(TransactionsView.dayLabel(day), color: T.muted)
            Spacer()
            if out > 0 {
                Text(out.money())
                    .font(F.mono(10.5))
                    .foregroundStyle(T.faint)
            }
        }
        .textCase(nil)
    }
}

private struct Row: View {
    @ObservedObject var txn: CDTransaction
    let categoryName: String
    let icon: String?
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            GlyphTile(icon: icon, color: txn.amount < 0 ? T.jade : color, size: 34)

            VStack(alignment: .leading, spacing: 3) {
                Text(txn.merchantName ?? txn.name ?? "—")
                    .font(F.medium(14))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Text(categoryName)
                    if txn.pending {
                        Text("·")
                        Text("pending").foregroundStyle(T.brass)
                    }
                    if let account = txn.account?.name {
                        Text("·")
                        Text(account).lineLimit(1)
                    }
                }
                .font(F.body(11.5))
                .foregroundStyle(T.faint)
                .lineLimit(1)
            }

            Spacer(minLength: 8)

            // Plaid's convention: positive is money leaving. Inflows are the
            // ones worth colouring, because they're the exception.
            VStack(alignment: .trailing, spacing: 4) {
                Text((txn.amount < 0 ? "+" : "") + abs(txn.amount).money(txn.isoCurrencyCode ?? "USD"))
                    .font(F.mono(13.5))
                    .foregroundStyle(txn.amount > 0 ? T.paper : T.jade)
                if !txn.reviewed {
                    Text("REVIEW")
                        .font(F.semibold(8.5))
                        .tracking(1)
                        .foregroundStyle(T.brass)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(T.brass.opacity(0.12)))
                        .accessibilityLabel("Needs review")
                }
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
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
        let styles = CategoryStyles(categories: categories)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text((txn.amount < 0 ? "+" : "") + abs(txn.amount).money(txn.isoCurrencyCode ?? "USD"))
                            .font(F.display(36))
                            .tracking(-0.8)
                            .foregroundStyle(txn.amount < 0 ? T.jade : T.paper)
                        Text(merchant).font(F.medium(16)).foregroundStyle(T.paper)
                        Text([TransactionsView.dayLabel(txn.date ?? ""), txn.account?.name, "now \(index.displayName(for: txn))"]
                                .compactMap { $0 }.joined(separator: " · "))
                            .font(F.body(12))
                            .foregroundStyle(T.faint)
                    }

                    Toggle(isOn: $applyToMerchant) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Apply to all \(merchant)").font(F.medium(14)).foregroundStyle(T.paper)
                            Text("Only rows you haven't already decided on")
                                .font(F.body(11.5))
                                .foregroundStyle(T.faint)
                        }
                    }
                    .tint(T.jade)
                    .padding(14)
                    .background(CardSurface(radius: T.radiusSmall))

                    ForEach(grouped, id: \.group) { section in
                        VStack(alignment: .leading, spacing: 10) {
                            Eyebrow(section.group)
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                                ForEach(section.items, id: \.objectID) { cat in
                                    chip(cat, styles: styles)
                                }
                            }
                        }
                    }

                    if txn.userCategory != nil {
                        VStack(alignment: .leading, spacing: 8) {
                            PillButton(title: "Clear override", systemImage: "arrow.uturn.backward", role: .destructive) {
                                choose(nil)
                            }
                            Text("Falls back to the bank's category. Stays reviewed — you already made a call.")
                                .font(F.body(11.5))
                                .foregroundStyle(T.faint)
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Categorise")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
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
        .bSheet([.medium, .large])
    }

    private func chip(_ cat: CDCategory, styles: CategoryStyles) -> some View {
        let selected = txn.userCategory?.objectID == cat.objectID
        let tint = styles.color(cat.id)
        return Button {
            choose(cat)
        } label: {
            HStack(spacing: 8) {
                GlyphIcon(icon: cat.icon, color: selected ? T.onJade : tint, size: 12)
                Text(cat.name ?? "—")
                    .font(F.medium(13))
                    .foregroundStyle(selected ? T.onJade : T.paper)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(T.onJade)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(selected ? T.jade : T.panel2)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .strokeBorder(selected ? T.jade : T.line, lineWidth: 0.75)
            )
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.pressScale)
    }

    private func choose(_ cat: CDCategory?) {
        do {
            if let cat, applyToMerchant {
                try repo.applyCategoryToMerchant(cat, merchant: merchant)
            }
            try repo.setCategory(cat, on: txn)
            Haptics.success()
            dismiss()
        } catch {
            Haptics.error()
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
