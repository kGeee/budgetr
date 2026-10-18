import CoreData
import SwiftUI

/// The review queue — one transaction at a time.
///
/// Browsing a list is how you avoid a backlog; being handed one row with the
/// decision in front of you is how you clear it. The card on top is the
/// decision, the one peeking behind it is what's next, and swiping right says
/// "the bank had it right". Same write path as the ledger, so a decision made
/// here shows up there immediately.
struct ReviewView: View {
    @Environment(\.managedObjectContext) private var context

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "date", ascending: false)],
        predicate: NSPredicate(format: "reviewed == NO"),
        animation: M.settle
    )
    private var queue: FetchedResults<CDTransaction>

    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "sortOrder", ascending: true)],
        predicate: NSPredicate(format: "archived == NO")
    )
    private var categories: FetchedResults<CDCategory>

    @State private var error: String?
    @State private var filed: Filed?
    @State private var drag: CGFloat = 0
    @State private var armed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The last decision, said back for a moment.
    private struct Filed: Equatable {
        let id = UUID()
        let text: String
    }

    private var total: Int {
        let request = NSFetchRequest<NSNumber>(entityName: "CDTransaction")
        request.resultType = .countResultType
        return (try? context.count(for: request)) ?? 0
    }

    private var spending: [CDCategory] {
        categories.filter { ($0.group ?? "spending") == "spending" }
    }

    var body: some View {
        let idx = CategoryIndex(categories: Array(categories))
        let styles = CategoryStyles(categories: Array(categories))

        BScreen("Review", eyebrow: queue.isEmpty ? "All clear" : "\(queue.count) left to review") {
            if let txn = queue.first {
                progress.rise(0)

                ZStack(alignment: .bottom) {
                    if queue.count > 1 {
                        PeekCard(txn: queue[1])
                    }
                    ReviewCard(
                        txn: txn,
                        categoryName: idx.displayName(for: txn),
                        icon: styles.icon(idx.resolvedId(for: txn)),
                        color: styles.color(idx.resolvedId(for: txn)),
                        drag: drag
                    )
                    .offset(x: drag)
                    .rotationEffect(.degrees(reduceMotion ? 0 : Double(drag / 28)), anchor: .bottom)
                    .simultaneousGesture(swipe(txn))
                    .id(txn.objectID)
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.asymmetric(
                        insertion: AnyTransition.scale(scale: 0.96).combined(with: .opacity),
                        removal: AnyTransition.move(edge: .leading).combined(with: .opacity)
                    ))
                }
                .rise(1)

                if let filed {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(T.jade)
                        Text(filed.text).font(F.body(12.5)).foregroundStyle(T.muted)
                    }
                    .transition(.opacity)
                    .id(filed.id)
                }

                TitledCard("File it as", trailing: "swipe right to keep") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], spacing: 8) {
                        ForEach(spending, id: \.objectID) { cat in
                            chip(cat, txn: txn, idx: idx, styles: styles)
                        }
                    }
                }
                .rise(2)

                Button {
                    keep(txn, idx: idx)
                } label: {
                    HStack(spacing: 6) {
                        Text("Looks right — keep \(idx.displayName(for: txn))")
                        Image(systemName: "arrow.right")
                    }
                    .font(F.semibold(13))
                    .foregroundStyle(T.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.pressScale)
                .rise(3)
            } else {
                Card {
                    EmptyState(
                        symbol: "checkmark.seal",
                        title: "Nothing to review",
                        message: "Every transaction has a decision on it. New ones land here after each import."
                    )
                }
                .rise(0)
            }
        }
        .alert("Couldn't save", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: { Text(error ?? "") }
    }

    private var progress: some View {
        let t = max(total, 1)
        let done = t - queue.count
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(done) of \(t) reviewed")
                    .font(F.mono(11))
                    .foregroundStyle(T.faint)
                Spacer()
                Text("\(Int((Double(done) / Double(t) * 100).rounded()))%")
                    .font(F.monoSemibold(11))
                    .foregroundStyle(T.jade)
            }
            SlimMeter(fraction: Double(done) / Double(t), color: T.jade, height: 4)
        }
    }

    private func chip(_ cat: CDCategory, txn: CDTransaction, idx: CategoryIndex, styles: CategoryStyles) -> some View {
        let isGuess = idx.resolvedId(for: txn) == cat.id
        let tint = styles.color(cat.id)
        return Button {
            assign(cat, to: txn)
        } label: {
            HStack(spacing: 8) {
                GlyphIcon(icon: cat.icon, color: tint, size: 12)
                Text(cat.name ?? "—")
                    .font(F.medium(13))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(isGuess ? tint.opacity(0.14) : T.panel2)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .strokeBorder(isGuess ? tint.opacity(0.5) : T.line, lineWidth: 0.75)
            )
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.pressScale)
        .accessibilityHint(isGuess ? "The bank's guess" : "")
    }

    private func swipe(_ txn: CDTransaction) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { v in
                // Only a mostly-horizontal drag moves the card, so scrolling
                // the page past it still scrolls the page.
                let x = v.translation.width
                guard abs(x) > abs(v.translation.height) * 1.5 else { return }
                // Rightward is "keep"; leftward resists, because there is no
                // left action to commit to.
                drag = x > 0 ? x : x / 4
                let nowArmed = x > 110
                if nowArmed != armed {
                    armed = nowArmed
                    Haptics.tick()
                }
            }
            .onEnded { v in
                let horizontal = abs(v.translation.width) > abs(v.translation.height) * 1.5
                if horizontal && (v.translation.width > 110 || v.predictedEndTranslation.width > 220) {
                    keep(txn, idx: CategoryIndex(categories: Array(categories)))
                }
                armed = false
                withAnimation(M.snappy) { drag = 0 }
            }
    }

    private func keep(_ txn: CDTransaction, idx: CategoryIndex) {
        let name = idx.displayName(for: txn)
        commit("Kept as \(name)") {
            try TransactionRepository(context: context).setReviewed(true, on: txn)
        }
    }

    private func assign(_ cat: CDCategory, to txn: CDTransaction) {
        commit("Filed as \(cat.name ?? "—")") {
            try TransactionRepository(context: context).setCategory(cat, on: txn)
        }
    }

    private func commit(_ message: String, _ write: () throws -> Void) {
        do {
            try withAnimation(reduceMotion ? .easeOut(duration: 0.18) : M.settle) {
                try write()
                filed = Filed(text: message)
            }
            Haptics.success()
        } catch {
            Haptics.error()
            self.error = error.localizedDescription
        }
    }
}

/// The decision card.
private struct ReviewCard: View {
    @ObservedObject var txn: CDTransaction
    let categoryName: String
    let icon: String?
    let color: Color
    let drag: CGFloat

    var body: some View {
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    GlyphTile(icon: icon, color: color, size: 38)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(txn.merchantName ?? txn.name ?? "—")
                            .font(F.semibold(16))
                            .foregroundStyle(T.paper)
                            .lineLimit(1)
                        Text("Bank says \(categoryName)")
                            .font(F.body(12))
                            .foregroundStyle(T.faint)
                    }
                    Spacer()
                    if txn.pending {
                        Text("PENDING")
                            .font(F.semibold(9))
                            .tracking(1)
                            .foregroundStyle(T.brass)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(T.brass.opacity(0.12)))
                    }
                }

                Text((txn.amount < 0 ? "+" : "") + abs(txn.amount).money(txn.isoCurrencyCode ?? "USD"))
                    .font(F.display(42))
                    .tracking(-1)
                    .foregroundStyle(txn.amount > 0 ? T.paper : T.jade)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                Text([TransactionsView.dayLabel(txn.date ?? ""), txn.account?.name]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(F.mono(11))
                    .foregroundStyle(T.faint)
            }
        }
        .overlay(alignment: .topTrailing) {
            // The swipe's promise, appearing as you commit to it.
            Text("KEEP")
                .font(F.monoSemibold(12))
                .tracking(1.5)
                .foregroundStyle(T.jade)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(T.jade, lineWidth: 1.5))
                .rotationEffect(.degrees(12))
                .padding(18)
                .opacity(Double(max(0, min(1, (drag - 30) / 80))))
        }
    }
}

/// The next transaction, peeking from behind — the queue has depth.
private struct PeekCard: View {
    @ObservedObject var txn: CDTransaction

    var body: some View {
        Card(padding: 20) {
            HStack {
                Text(txn.merchantName ?? txn.name ?? "—")
                    .font(F.semibold(14))
                    .foregroundStyle(T.muted)
                    .lineLimit(1)
                Spacer()
                Text(abs(txn.amount).money(txn.isoCurrencyCode ?? "USD"))
                    .font(F.mono(13))
                    .foregroundStyle(T.faint)
            }
        }
        .scaleEffect(0.93, anchor: .bottom)
        .offset(y: 14)
        .opacity(0.55)
        .accessibilityHidden(true)
    }
}
