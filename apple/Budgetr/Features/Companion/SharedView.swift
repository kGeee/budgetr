import SwiftUI

// Shared — money you've fronted for friends, and where each of them stands.
// The Mac owns the ledger: it splits bills (your share at its real category,
// the rest at the transfer-group cat_reimbursable, so it never reads as your
// spend), nets every balance against settlements, and spots Venmo/Zelle
// paybacks. The phone renders those results; it never recomputes a balance.

/// Every sheet Shared can raise, so they share one presentation slot.
enum SharedSheet: Identifiable {
    case person(Summary.Person)
    case bill(Summary.SharedExpense)
    case split(txnId: String?, personId: String?)
    case payback(personId: String?)

    var id: String {
        switch self {
        case .person(let p): return "person-\(p.id)"
        case .bill(let b): return "bill-\(b.id)"
        case .split(let t, let p): return "split-\(t ?? "")-\(p ?? "")"
        case .payback(let p): return "payback-\(p ?? "")"
        }
    }
}

struct CompanionSharedView: View {
    @EnvironmentObject private var companion: CompanionStore

    @State private var sheet: SharedSheet?
    @State private var showingAllBills = false
    @State private var addingPerson = false
    @State private var newName = ""
    @State private var newHandle = ""

    var body: some View {
        let s = companion.summary
        let people = companion.knownPeople

        BScreen("Shared", eyebrow: "Split bills", trailing: {
            if s != nil { addMenu }
        }) {
            CompanionStatusLine()
            if let s {
                if people.isEmpty && (s.shared ?? []).isEmpty {
                    Card {
                        EmptyState(
                            symbol: "person.2",
                            title: "Nothing split yet",
                            message: "Split a bill on your Mac and it shows up here — who owes you, for what, and when they've paid you back."
                        )
                    }
                    .rise(0)
                } else {
                    content(s)
                }
            } else {
                AwaitingSummaryPlaceholder().rise(0)
            }
        }
        .refreshable { await companion.refresh(manual: true) }
        .sheet(item: $sheet) { which in
            if let s { SharedSheetView(which: which, summary: s) }
        }
        .alert("Someone new", isPresented: $addingPerson) {
            TextField("Name", text: $newName)
            TextField("Venmo @username (optional)", text: $newHandle)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {}
            Button("Add") {
                let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty,
                      !companion.knownPeople.contains(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame })
                else { return }
                let handle = newHandle
                Task { await companion.addPerson(name: name, handle: handle) }
            }
        } message: {
            Text("They're added on your Mac when it next syncs.")
        }
    }

    /// The ＋ in the header: the things you can add from the phone.
    private var addMenu: some View {
        Menu {
            Button { sheet = .split(txnId: nil, personId: nil) } label: {
                Label("Split a bill", systemImage: "person.2")
            }
            Button { sheet = .payback(personId: nil) } label: {
                Label("Record a payback", systemImage: "arrow.down.left")
            }
            Button {
                newName = ""
                newHandle = ""
                addingPerson = true
            } label: {
                Label("Add a person", systemImage: "person.badge.plus")
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(T.onJade)
                .frame(width: 44, height: 44)
                .background(Circle().fill(T.jade))
                .contentShape(Circle())
        }
        .accessibilityLabel("Add to Shared")
    }

    @ViewBuilder
    private func content(_ s: Summary) -> some View {
        let people = companion.knownPeople
        let bills = s.shared ?? []
        let byId = Dictionary(people.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        // A suggestion already confirmed from here stops asking.
        let confirming = Set(companion.pending.compactMap { op -> String? in
            if case .recordSettlement(let o) = op { return o.txnId } else { return nil }
        })
        let suggestions = (s.settleSuggestions ?? []).filter { !confirming.contains($0.txnId) }
        let waiting = Set(suggestions.map(\.personId))

        let owed = people.reduce(0) { $0 + max(0, $1.cents) }
        let owe = people.reduce(0) { $0 + max(0, -$1.cents) }
        let net = owed - owe

        StatementHero(eyebrow: "Owed to you", cents: owed, color: owed > 0 ? T.paper : T.muted, verdict: {
            VerdictText(verdict(people: people, suggestions: suggestions, byId: byId))
        }, footer: {
            if owe > 0 {
                Text("net \(net >= 0 ? "+" : "−")\(abs(net).dollars.money())")
                    .font(F.mono(12))
                    .foregroundStyle(T.muted)
            }
        })
        .rise(0)

        statCells(bills: bills, people: people).rise(1)

        if !suggestions.isEmpty {
            StatementSection(title: "Looks like a payback", count: suggestions.count, countColor: T.brass) {
                ForEach(suggestions) { sg in
                    SuggestionRow(suggestion: sg, person: byId[sg.personId]) {
                        if let p = byId[sg.personId] { sheet = .person(p) }
                    } onConfirm: {
                        Task {
                            await companion.submit(.recordSettlement(.init(
                                id: CompanionOp.newId(), ts: CompanionOp.now(),
                                personId: sg.personId, cents: sg.cents, txnId: sg.txnId
                            )))
                        }
                    }
                }
            }
            .padding(.top, 6)
            .rise(2)
        }

        if !people.isEmpty {
            StatementSection(title: "People", count: people.count) {
                ForEach(sortedPeople(people)) { p in
                    PersonRow(person: p, waiting: waiting.contains(p.id), venmoNote: sharedVenmoNote(for: p, in: bills)) {
                        Haptics.tap()
                        sheet = .person(p)
                    }
                }
            }
            .padding(.top, 6)
            .rise(3)
        }

        if !bills.isEmpty {
            StatementSection(
                title: "Recent splits",
                action: bills.count > 4 ? (showingAllBills ? "Fewer" : "All \(bills.count) ›", { withAnimation(M.settle) { showingAllBills.toggle() } }) : nil
            ) {
                ForEach(showingAllBills ? bills : Array(bills.prefix(4))) { b in
                    Button {
                        Haptics.tap()
                        sheet = .bill(b)
                    } label: {
                        BillRow(bill: b)
                    }
                    .buttonStyle(.pressScale)
                }
            }
            .padding(.top, 6)
            .rise(4)
        }

        if !companion.pending.isEmpty {
            StatementSection(title: "Sending to your Mac", count: companion.pending.count, countColor: T.brass) {
                ForEach(companion.pending) { op in
                    PendingOpRow(op: op, summary: s, people: companion.knownPeople) {
                        Haptics.warning()
                        withAnimation(M.settle) { companion.discard(op) }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(.top, 6)
        }

        Text("Fronted shares sit outside your spending. Edits apply when your Mac next syncs.")
            .font(F.body(12))
            .foregroundStyle(T.muted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The hero's sentence, built only from what the Mac published: how many
    /// people owe, whether a payback is waiting, and what you owe.
    private func verdict(people: [Summary.Person], suggestions: [Summary.SettleSuggestion], byId: [String: Summary.Person]) -> Text {
        let owers = people.filter { $0.cents > 0 }
        let owe = people.reduce(0) { $0 + max(0, -$1.cents) }
        if owers.isEmpty && owe == 0 && suggestions.isEmpty { return Text("You're all square.") }

        var t: Text
        switch owers.count {
        case 0: t = Text("No one owes you")
        case 1: t = Text("\(owers[0].givenName) owes you")
        default: t = Text("\(Self.spelled(owers.count)) people owe you")
        }
        if suggestions.count == 1 {
            let who = byId[suggestions[0].personId]?.givenName ?? "Someone"
            t = t + Text(". ") + Text("\(who) looks paid").foregroundStyle(T.jade) + Text("; ")
        } else if suggestions.count > 1 {
            t = t + Text(". ") + Text("\(Self.spelled(suggestions.count)) paybacks look paid").foregroundStyle(T.jade) + Text("; ")
        } else {
            t = t + Text("; ")
        }
        if owe > 0 {
            t = t + Text("you owe ") + Text(owe.dollars.money()).foregroundStyle(T.coral) + Text(".")
        } else {
            t = t + Text("you owe no one.")
        }
        return t
    }

    /// "Two", "Three" … a sentence reads better than a digit; past twelve it doesn't.
    private static func spelled(_ n: Int) -> String {
        let words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"]
        return n >= 0 && n < words.count ? words[n] : "\(n)"
    }

    /// Who owes the most first, then who you owe, then the settled.
    private func sortedPeople(_ people: [Summary.Person]) -> [Summary.Person] {
        people.sorted {
            let a = $0.cents, b = $1.cents
            if (a > 0) != (b > 0) { return a > 0 }
            if (a == 0) != (b == 0) { return b == 0 }
            return abs(a) > abs(b)
        }
    }

    /// This month, in one ruled strip.
    private func statCells(bills: [Summary.SharedExpense], people: [Summary.Person]) -> some View {
        let month = CompanionModel.Month()
        let thisMonth = bills.filter { $0.ts >= month.startSec }
        let fronted = thisMonth.reduce(0) { $0 + ($1.cents - $1.myCents) }
        let mine = thisMonth.reduce(0) { $0 + $1.myCents }
        let open = people.reduce(0) { $0 + $1.openCount }
        return StatCells(cells: [
            .init(label: "Fronted", value: fronted.dollars.moneyCompact(), note: "for others", valueColor: T.brass),
            .init(label: "Your share", value: mine.dollars.moneyCompact(), note: "of \(thisMonth.count) bill\(thisMonth.count == 1 ? "" : "s")"),
            .init(label: "Open", value: "\(open)", note: "unsettled"),
        ])
    }
}

extension Summary.Person {
    /// "Maya Chen" → "Maya".
    var givenName: String { name.split(separator: " ").first.map(String.init) ?? name }
}

/// "Ippudo, Airbnb · Big Sur" — what a Venmo request is for, in their terms.
private func sharedVenmoNote(for person: Summary.Person, in bills: [Summary.SharedExpense]) -> String {
    let names = bills.filter { b in b.shares.contains { $0.personId == person.id } }.prefix(3).map(\.merchant)
    return names.isEmpty ? "Shared bills" : names.joined(separator: ", ")
}

/// The waiting state, without depending on the Spending screen's private one.
private struct AwaitingSummaryPlaceholder: View {
    @EnvironmentObject private var companion: CompanionStore

    var body: some View {
        Card {
            EmptyState(
                symbol: "antenna.radiowaves.left.and.right",
                title: "Waiting for your Mac",
                message: "Shared balances arrive with the next summary your Mac publishes."
            ) {
                PillButton(title: companion.refreshing ? "Checking…" : "Check now", systemImage: "arrow.clockwise") {
                    Task { await companion.refresh(manual: true) }
                }
            }
        }
    }
}

// ── People ───────────────────────────────────────────────────────────

/// A person's initials on their colour — the Mac assigns it, so they look the
/// same in both apps.
struct PersonAvatar: View {
    let name: String
    var color: Color
    var size: CGFloat = 36

    /// You, wherever you appear beside other people.
    static let me = T.brass

    init(person: Summary.Person, size: CGFloat = 36) {
        name = person.name
        color = Self.color(for: person)
        self.size = size
    }

    init(name: String, color: Color, size: CGFloat = 36) {
        self.name = name
        self.color = color
        self.size = size
    }

    static func color(for p: Summary.Person) -> Color {
        if let c = Color(hexString: p.color) { return c }
        let h = p.id.unicodeScalars.reduce(UInt32(5)) { ($0 &* 31) &+ $1.value }
        return T.chart[Int(h % UInt32(T.chart.count - 1))]
    }

    /// "Sam Lee" → "SL"; "You" stays "You".
    static func initials(_ name: String, limit: Int = 2) -> String {
        if name == "You" && limit > 1 { return "You" }
        let parts = name.split(separator: " ").prefix(limit).compactMap(\.first)
        return parts.isEmpty ? "?" : String(parts).uppercased()
    }

    var body: some View {
        ZStack {
            Circle().fill(color)
            // Two letters don't fit an avatar small enough to stack.
            Text(Self.initials(name, limit: size < 28 ? 1 : 2))
                .font(F.semibold(size * 0.34))
                .foregroundStyle(T.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.horizontal, 2)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A person as a small coloured tag — who is on a receipt line.
struct PersonTag: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(F.semibold(10))
            .foregroundStyle(T.ink)
            .lineLimit(1)
            .padding(.horizontal, 5)
            .frame(minWidth: 26, minHeight: 22)
            .background(Capsule().fill(color))
    }
}

/// One person on the canvas: who, where they stand, and the request button
/// when they owe you.
private struct PersonRow: View {
    let person: Summary.Person
    let waiting: Bool
    let venmoNote: String
    let open: () -> Void

    var body: some View {
        RuledRow(minHeight: 60) {
            HStack(spacing: 12) {
                Button(action: open) {
                    HStack(spacing: 12) {
                        PersonAvatar(person: person, size: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(person.name).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                            standing
                                .font(F.mono(12))
                                .foregroundStyle(T.muted)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 60)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressScale)
                .accessibilityElement(children: .combine)

                if person.cents > 0 {
                    VenmoRequestButton(person: person, cents: person.cents, note: venmoNote, compact: true, label: "Request on Venmo")
                        .fixedSize()
                }
            }
        }
    }

    /// "owes $47.33 · payback waiting" / "you owe $4.00" / "settled".
    private var standing: Text {
        var t: Text
        if person.cents > 0 {
            t = Text("owes \(person.cents.dollars.money())")
        } else if person.cents < 0 {
            t = Text("you owe \(abs(person.cents).dollars.money())").foregroundStyle(T.coral)
        } else {
            t = Text("settled")
        }
        if waiting {
            t = t + Text(" · payback waiting").foregroundStyle(T.jade)
        } else if person.openCount > 0 {
            t = t + Text(" · \(person.openCount) open")
        }
        return t
    }
}

/// A payback the Mac spotted: who paid how much, where it matched, and the
/// button that settles it.
private struct SuggestionRow: View {
    let suggestion: Summary.SettleSuggestion
    let person: Summary.Person?
    let action: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        RuledRow(minHeight: 64) {
            HStack(spacing: 12) {
                Button {
                    Haptics.tap()
                    action()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        (Text("\(person?.givenName ?? "Someone") paid you ").font(F.medium(15))
                            + Text(suggestion.cents.dollars.money()).font(F.mono(14)).foregroundStyle(T.jade))
                            .foregroundStyle(T.paper)
                            .lineLimit(2)
                        Text(suggestion.detail).font(F.body(12)).foregroundStyle(T.muted).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressScale)
                .accessibilityElement(children: .combine)

                Button {
                    onConfirm()
                } label: {
                    Text("Confirm")
                        .font(F.semibold(15))
                        .foregroundStyle(T.onJade)
                        .padding(.horizontal, 18)
                        .frame(minHeight: 44)
                        .background(Capsule().fill(T.jade))
                        .contentShape(Capsule())
                }
                .buttonStyle(.pressScale)
                .accessibilityLabel("Confirm payback")
            }
        }
    }
}

// ── Bills ────────────────────────────────────────────────────────────

/// The slices of one bill, you first, in each person's colour.
private func billSlices(_ bill: Summary.SharedExpense, _ people: [String: Summary.Person]) -> [MixSlice] {
    var slices = [MixSlice(id: "__me", name: "You", value: bill.myCents.dollars, color: PersonAvatar.me)]
    for (i, sh) in bill.shares.enumerated() where sh.cents > 0 {
        let p = people[sh.personId]
        slices.append(MixSlice(
            id: "\(sh.personId)-\(i)",
            name: p?.name ?? "Someone",
            value: sh.cents.dollars,
            color: p.map(PersonAvatar.color(for:)) ?? T.muted
        ))
    }
    return slices
}

/// How a bill was divided, as far as its shares can say: the Mac marks an
/// itemised split; equal parts (give or take the odd cents) read as even.
private func splitKind(_ bill: Summary.SharedExpense) -> String {
    if bill.itemized == true { return "BY ITEM" }
    let parts = bill.shares.map(\.cents) + (bill.myCents > 0 ? [bill.myCents] : [])
    guard let lo = parts.min(), let hi = parts.max() else { return "EVENLY" }
    return hi - lo <= parts.count ? "EVENLY" : "CUSTOM"
}

/// EVENLY / BY ITEM — a small outlined tag beside a merchant.
private struct SplitTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(F.semibold(10))
            .tracking(0.8)
            .foregroundStyle(T.brass)
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(T.brassDim, lineWidth: 1))
            .fixedSize()
    }
}

private struct BillRow: View {
    let bill: Summary.SharedExpense

    var body: some View {
        RuledRow(minHeight: 60) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(bill.merchant).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                        SplitTag(text: splitKind(bill))
                    }
                    Text("\(CompanionFormat.day(bill.ts)) · yours \(bill.myCents.dollars.money()) · fronted \((bill.cents - bill.myCents).dollars.money())")
                        .font(F.body(12)).foregroundStyle(T.muted)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                Text(bill.cents.dollars.money()).font(F.mono(14)).foregroundStyle(T.paper)
            }
            .padding(.vertical, 8)
        }
        .accessibilityElement(children: .combine)
    }
}

// ── Sheets ───────────────────────────────────────────────────────────

/// One person: where you stand, what's open with them, and any payback the
/// Mac has spotted.
private struct PersonSheet: View {
    let person: Summary.Person
    let summary: Summary

    @State private var entry: SharedSheet?

    var body: some View {
        let bills = (summary.shared ?? []).filter { b in b.shares.contains { $0.personId == person.id } }
        let suggestions = (summary.settleSuggestions ?? []).filter { $0.personId == person.id }
        let theirTotal = bills.reduce(0) { acc, b in acc + b.shares.filter { $0.personId == person.id }.reduce(0) { $0 + $1.cents } }

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    PersonAvatar(person: person, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(person.name).font(F.display(24)).foregroundStyle(T.paper)
                        Text(person.openCount > 0 ? "\(person.openCount) open bill\(person.openCount == 1 ? "" : "s")" : "nothing open")
                            .font(F.body(13)).foregroundStyle(T.muted)
                    }
                }

                StatementHero(
                    eyebrow: person.cents > 0 ? "Owes you" : person.cents < 0 ? "You owe" : "Balance",
                    cents: abs(person.cents),
                    color: person.cents == 0 ? T.muted : T.paper,
                    size: 44
                ) {
                    VerdictText(standing)
                }
                .padding(.top, 22)

                if person.cents > 0 {
                    VenmoRequestButton(person: person, cents: person.cents, note: sharedVenmoNote(for: person, in: bills))
                        .padding(.top, 18)
                }

                HStack(spacing: 10) {
                    PillButton(title: "Payback", systemImage: "arrow.down.left", role: person.cents > 0 ? .primary : .standard) {
                        Haptics.tap()
                        entry = .payback(personId: person.id)
                    }
                    PillButton(title: "Split a bill", systemImage: "person.2") {
                        Haptics.tap()
                        entry = .split(txnId: nil, personId: person.id)
                    }
                }
                .padding(.top, person.cents > 0 ? 10 : 18)

                if !suggestions.isEmpty {
                    StatementSection(title: "Spotted paybacks", count: suggestions.count, countColor: T.brass) {
                        ForEach(suggestions) { sg in
                            RuledRow {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(sg.detail).font(F.medium(14)).foregroundStyle(T.paper)
                                            .fixedSize(horizontal: false, vertical: true)
                                        Text(CompanionFormat.day(sg.ts)).font(F.body(12)).foregroundStyle(T.muted)
                                    }
                                    Spacer(minLength: 6)
                                    Text(sg.cents.dollars.money()).font(F.mono(14)).foregroundStyle(T.jade)
                                }
                                .padding(.vertical, 8)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .padding(.top, 26)
                    Text("Confirm it from the Shared tab and the balance updates once your Mac applies it.")
                        .font(F.body(12)).foregroundStyle(T.muted).padding(.top, 8)
                        .fixedSize(horizontal: false, vertical: true)
                }

                StatementSection(title: "Bills together", count: bills.isEmpty ? nil : bills.count) {
                    if bills.isEmpty {
                        Text("No recent bills with \(person.givenName).")
                            .font(F.body(13)).foregroundStyle(T.muted).padding(.vertical, 14)
                    } else {
                        ForEach(bills) { b in
                            let theirs = b.shares.filter { $0.personId == person.id }.reduce(0) { $0 + $1.cents }
                            RuledRow(minHeight: 56) {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(b.merchant).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                                        Text("\(CompanionFormat.day(b.ts)) · bill \(b.cents.dollars.money()) · \(Int((Double(theirs) / Double(max(1, b.cents)) * 100).rounded()))% share")
                                            .font(F.body(12)).foregroundStyle(T.muted).lineLimit(1)
                                    }
                                    Spacer(minLength: 6)
                                    Text(theirs.dollars.money()).font(F.mono(14)).foregroundStyle(T.paper)
                                }
                                .padding(.vertical, 8)
                            }
                            .accessibilityElement(children: .combine)
                        }
                        if theirTotal > 0 {
                            HStack {
                                Text("Their shares").font(F.medium(14)).foregroundStyle(T.paper)
                                Spacer()
                                Text(theirTotal.dollars.money()).font(F.mono(14)).foregroundStyle(T.paper)
                            }
                            .frame(minHeight: 44)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                .padding(.top, 26)
            }
            .padding(22)
        }
        .bSheet()
        .sheet(item: $entry) { which in SharedSheetView(which: which, summary: summary) }
    }

    private var standing: String {
        if person.cents == 0 { return "You're all square." }
        if let t = person.lastSettledAt {
            return "Last settled \(CompanionFormat.ago(Date(timeIntervalSince1970: TimeInterval(t))))."
        }
        return "Never settled up."
    }
}

/// One bill: who had what, as a bar and ruled rows.
private struct BillSheet: View {
    let bill: Summary.SharedExpense
    let summary: Summary

    var body: some View {
        let people = Dictionary((summary.people ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let mine = bill.cents > 0 ? Double(bill.myCents) / Double(bill.cents) : 0

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(bill.merchant).font(F.display(24)).foregroundStyle(T.paper).lineLimit(1)
                    SplitTag(text: splitKind(bill))
                }
                Text(CompanionFormat.weekday(bill.ts)).font(F.body(13)).foregroundStyle(T.muted).padding(.top, 2)

                StatementHero(eyebrow: "The bill", cents: bill.cents, size: 44, verdict: {
                    VerdictText(
                        Text("You fronted ")
                            + Text((bill.cents - bill.myCents).dollars.money()).foregroundStyle(T.brass)
                            + Text(" of it; ")
                            + Text(bill.myCents.dollars.money())
                            + Text(" was yours.")
                    )
                }, footer: {
                    StackedBar(slices: billSlices(bill, people), height: 6).padding(.top, 4)
                    if let note = bill.note {
                        Text(note).font(F.body(13)).foregroundStyle(T.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                })
                .padding(.top, 22)

                StatementSection(title: "Who had what", count: bill.shares.count + 1) {
                    shareRow(avatar: AnyView(PersonAvatar(name: "You", color: PersonAvatar.me, size: 34)),
                             name: "You", detail: "your share · counts as your spend",
                             cents: bill.myCents, fraction: mine)
                    ForEach(Array(bill.shares.enumerated()), id: \.offset) { _, sh in
                        let p = people[sh.personId]
                        shareRow(
                            avatar: AnyView(p.map { PersonAvatar(person: $0, size: 34) } ?? PersonAvatar(name: "?", color: T.muted, size: 34)),
                            name: p?.name ?? "Someone",
                            detail: "fronted · held outside your spending",
                            cents: sh.cents,
                            fraction: bill.cents > 0 ? Double(sh.cents) / Double(bill.cents) : 0,
                            person: p
                        )
                    }
                }
                .padding(.top, 26)
            }
            .padding(22)
        }
        .bSheet()
    }

    private func shareRow(avatar: AnyView, name: String, detail: String, cents: Int, fraction: Double, person: Summary.Person? = nil) -> some View {
        RuledRow(minHeight: 60) {
            HStack(spacing: 12) {
                avatar
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                    Text(detail).font(F.body(12)).foregroundStyle(T.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(cents.dollars.money()).font(F.mono(14)).foregroundStyle(T.paper)
                    Text(CompanionFormat.percent(fraction)).font(F.mono(11)).foregroundStyle(T.muted)
                }
                if let person, cents > 0 {
                    VenmoRequestButton(person: person, cents: cents, note: bill.note.map { "\(bill.merchant) — \($0)" } ?? bill.merchant, compact: true)
                        .fixedSize()
                }
            }
            .padding(.vertical, 8)
        }
    }
}

/// Routes a SharedSheet to its view.
struct SharedSheetView: View {
    let which: SharedSheet
    let summary: Summary

    var body: some View {
        switch which {
        case .person(let p): PersonSheet(person: p, summary: summary)
        case .bill(let b): BillSheet(bill: b, summary: summary)
        case .split(let t, let p): SplitBillSheet(summary: summary, preselectedTxnId: t, preselectedPersonId: p)
        case .payback(let p): RecordPaybackSheet(summary: summary, preselectedPersonId: p)
        }
    }
}
