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

        BScreen("Shared", eyebrow: people.isEmpty ? "Split bills" : "Split bills · \(people.count) \(people.count == 1 ? "person" : "people")", trailing: {
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

    /// The ＋ in the header: the two things you can add from the phone.
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
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(T.onJade)
                .frame(width: 36, height: 36)
                .background(Circle().fill(T.jade))
                .shadow(color: T.jade.opacity(0.35), radius: 8, y: 2)
        }
        .accessibilityLabel("Add to Shared")
    }

    @ViewBuilder
    private func content(_ s: Summary) -> some View {
        let people = companion.knownPeople
        let bills = s.shared ?? []
        let byId = Dictionary(people.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        BalanceHero(people: people).rise(0)

        statTiles(bills: bills, people: people).rise(1)

        if !companion.pending.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "Sending to your Mac", detail: "\(companion.pending.count)")
                VStack(spacing: 8) {
                    ForEach(companion.pending) { op in
                        PendingOpRow(op: op, summary: s, people: companion.knownPeople) {
                            Haptics.warning()
                            withAnimation(M.settle) { companion.discard(op) }
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
            }
        }

        // A suggestion already confirmed from here stops asking.
        let confirming = Set(companion.pending.compactMap { op -> String? in
            if case .recordSettlement(let o) = op { return o.txnId } else { return nil }
        })
        let suggestions = (s.settleSuggestions ?? []).filter { !confirming.contains($0.txnId) }
        if !suggestions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "Looks like a payback", detail: "\(suggestions.count)")
                VStack(spacing: 8) {
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
            }
            .rise(2)
        }

        if !people.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "People", detail: "\(people.count)")
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(sortedPeople(people).enumerated()), id: \.element.id) { i, p in
                            Button {
                                Haptics.tap()
                                sheet = .person(p)
                            } label: {
                                PersonRow(person: p)
                                    .padding(.horizontal, 14)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.pressScale)
                            .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 66) } }
                        }
                    }
                }
            }
            .rise(3)
        }

        if !bills.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(
                    title: "Recent splits",
                    detail: "\(bills.count)",
                    action: bills.count > 4 ? (showingAllBills ? "Fewer" : "All \(bills.count) ›", { withAnimation(M.settle) { showingAllBills.toggle() } }) : nil
                )
                VStack(spacing: 10) {
                    ForEach(Array((showingAllBills ? bills : Array(bills.prefix(4))).enumerated()), id: \.element.id) { i, b in
                        Button {
                            Haptics.tap()
                            sheet = .bill(b)
                        } label: {
                            BillCard(bill: b, people: byId)
                        }
                        .buttonStyle(.pressScale)
                        .rise(5 + i)
                    }
                }
            }
            .rise(4)
        }

        Text("Fronted shares sit outside your spending, so a dinner you paid for four counts only your plate. Edits made here are applied by your Mac on its next sync.")
            .font(F.body(11.5))
            .foregroundStyle(T.faint)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
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

    private func statTiles(bills: [Summary.SharedExpense], people: [Summary.Person]) -> some View {
        let month = CompanionModel.Month()
        let thisMonth = bills.filter { $0.ts >= month.startSec }
        let fronted = thisMonth.reduce(0) { $0 + ($1.cents - $1.myCents) }
        let mine = thisMonth.reduce(0) { $0 + $1.myCents }
        let open = people.reduce(0) { $0 + $1.openCount }
        return HStack(spacing: 8) {
            StatTile(label: "Fronted", value: fronted.dollars.moneyCompact(), tint: T.brass, note: "for others")
            StatTile(label: "Your share", value: mine.dollars.moneyCompact(), note: "of \(thisMonth.count) bill\(thisMonth.count == 1 ? "" : "s")")
            StatTile(label: "Open", value: "\(open)", note: "unsettled")
        }
    }
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

// ── Balance ──────────────────────────────────────────────────────────

/// What you're owed, said big; what you owe, said beside it; and who makes up
/// the total, as one bar in each person's colour.
private struct BalanceHero: View {
    let people: [Summary.Person]

    var body: some View {
        let owed = people.reduce(0) { $0 + max(0, $1.cents) }
        let owe = people.reduce(0) { $0 + max(0, -$1.cents) }
        let net = owed - owe
        let owers = people.filter { $0.cents > 0 }.sorted { $0.cents > $1.cents }

        VStack(alignment: .leading, spacing: 10) {
            Text("OWED TO YOU").font(F.mono(10)).tracking(1.2).foregroundStyle(T.muted)
            AnimatedMoney(value: owed.dollars, font: F.display(44), color: owed > 0 ? T.paper : T.muted)
            HStack(spacing: 10) {
                if owe > 0 {
                    Label {
                        Text("you owe \(owe.dollars.money())")
                    } icon: {
                        Circle().fill(T.coral).frame(width: 6, height: 6)
                    }
                    .foregroundStyle(T.coral)
                }
                Text(net == 0 ? "all square" : "net \(net > 0 ? "+" : "−")\(abs(net).dollars.money())")
                    .foregroundStyle(T.faint)
            }
            .font(F.mono(12))

            if owers.count > 0 && owed > 0 {
                StackedBar(slices: owers.map {
                    MixSlice(id: $0.id, name: $0.name, value: $0.cents.dollars, color: PersonAvatar.color(for: $0))
                }, height: 10)
                .padding(.top, 6)
                // The three biggest, named — the bar alone says "who", not "how much".
                HStack(spacing: 14) {
                    ForEach(owers.prefix(3)) { p in
                        HStack(spacing: 6) {
                            Circle().fill(PersonAvatar.color(for: p)).frame(width: 7, height: 7)
                            Text(p.name.split(separator: " ").first.map(String.init) ?? p.name)
                                .font(F.body(11.5)).foregroundStyle(T.muted)
                            Text(p.cents.dollars.moneyCompact()).font(F.mono(11)).foregroundStyle(T.paper)
                        }
                    }
                    if owers.count > 3 {
                        Text("+\(owers.count - 3)").font(F.mono(11)).foregroundStyle(T.faint)
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .heroGlow(owed > 0 ? T.jade : T.brass)
    }
}

// ── People ───────────────────────────────────────────────────────────

/// A person's initials in their colour — the Mac assigns it, so they look the
/// same in both apps.
struct PersonAvatar: View {
    let name: String
    var color: Color
    var size: CGFloat = 36

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

    private var initials: String {
        // Two letters don't fit an avatar small enough to stack.
        let parts = name.split(separator: " ").prefix(size < 28 ? 1 : 2).compactMap(\.first)
        return parts.isEmpty ? "?" : String(parts).uppercased()
    }

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [color.opacity(0.32), color.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing))
            Circle().strokeBorder(color.opacity(0.45), lineWidth: 1)
            Text(initials)
                .font(F.semibold(size * 0.36))
                .foregroundStyle(color)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private struct PersonRow: View {
    let person: Summary.Person

    var body: some View {
        HStack(spacing: 12) {
            PersonAvatar(person: person, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(person.name).font(F.medium(14.5)).foregroundStyle(T.paper).lineLimit(1)
                Text(subtitle).font(F.body(11.5)).foregroundStyle(T.faint).lineLimit(1)
            }
            Spacer(minLength: 8)
            BalanceLabel(cents: person.cents)
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(T.faint)
        }
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        var parts: [String] = []
        if person.openCount > 0 { parts.append("\(person.openCount) open bill\(person.openCount == 1 ? "" : "s")") }
        if let t = person.lastSettledAt {
            parts.append("settled \(CompanionFormat.ago(Date(timeIntervalSince1970: TimeInterval(t))))")
        } else if person.openCount > 0 {
            parts.append("never settled")
        }
        return parts.isEmpty ? "nothing open" : parts.joined(separator: " · ")
    }
}

/// "owes you $12.40" / "you owe $4" / "settled", coloured by direction.
private struct BalanceLabel: View {
    let cents: Int
    var large = false

    var body: some View {
        VStack(alignment: .trailing, spacing: 1) {
            if cents == 0 {
                Text("settled").font(F.mono(large ? 14 : 12.5)).foregroundStyle(T.muted)
            } else {
                Text(abs(cents).dollars.money())
                    .font(F.monoSemibold(large ? 16 : 13.5))
                    .foregroundStyle(cents > 0 ? T.jade : T.coral)
                Text(cents > 0 ? "owes you" : "you owe")
                    .font(F.body(10))
                    .foregroundStyle(T.faint)
            }
        }
    }
}

private struct SuggestionRow: View {
    let suggestion: Summary.SettleSuggestion
    let person: Summary.Person?
    let action: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            HStack(spacing: 11) {
                ZStack(alignment: .bottomTrailing) {
                    if let person {
                        PersonAvatar(person: person, size: 36)
                    } else {
                        PersonAvatar(name: "?", color: T.muted, size: 36)
                    }
                    Image(systemName: "checkmark")
                        .font(.system(size: 7.5, weight: .heavy))
                        .foregroundStyle(T.onJade)
                        .frame(width: 15, height: 15)
                        .background(Circle().fill(T.jade))
                        .overlay(Circle().strokeBorder(T.ink, lineWidth: 1.5))
                        .offset(x: 3, y: 3)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(person?.name.split(separator: " ").first.map(String.init) ?? "Someone") paid you \(suggestion.cents.dollars.money())")
                        .font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                    Text(suggestion.detail).font(F.body(11.5)).foregroundStyle(T.muted).lineLimit(1)
                }
                Spacer(minLength: 6)
                Button {
                    onConfirm()
                } label: {
                    Text("Confirm")
                        .font(F.semibold(12.5))
                        .foregroundStyle(T.onJade)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Capsule().fill(T.jade))
                }
                .buttonStyle(.pressScale)
                .accessibilityLabel("Confirm payback")
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(LinearGradient(colors: [T.jade.opacity(0.1), T.panel.opacity(0.85)], startPoint: .leading, endPoint: .trailing))
            )
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(T.jade.opacity(0.3), lineWidth: 0.75))
        }
        .buttonStyle(.pressScale)
        .accessibilityElement(children: .combine)
    }
}

// ── Bills ────────────────────────────────────────────────────────────

/// The slices of one bill, you first, in each person's colour.
private func billSlices(_ bill: Summary.SharedExpense, _ people: [String: Summary.Person]) -> [MixSlice] {
    var slices = [MixSlice(id: "__me", name: "You", value: bill.myCents.dollars, color: T.paper.opacity(0.8))]
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

private struct BillCard: View {
    let bill: Summary.SharedExpense
    let people: [String: Summary.Person]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                MerchantAvatar(name: bill.merchant, icon: "Users", size: 38)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(bill.merchant).font(F.medium(14)).foregroundStyle(T.paper).lineLimit(1)
                        if bill.itemized == true { ItemizedChip() }
                    }
                    Text([CompanionFormat.day(bill.ts), bill.note].compactMap { $0 }.joined(separator: " · "))
                        .font(F.body(11.5)).foregroundStyle(T.faint).lineLimit(1)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(bill.cents.dollars.money()).font(F.mono(13.5)).foregroundStyle(T.paper)
                    Text("yours \(bill.myCents.dollars.money())").font(F.mono(10)).foregroundStyle(T.brass)
                }
            }
            StackedBar(slices: billSlices(bill, people), height: 6)
            HStack(spacing: 8) {
                AvatarStack(people: bill.shares.compactMap { people[$0.personId] })
                Text(namesLine).font(F.body(11)).foregroundStyle(T.muted).lineLimit(1)
                Spacer(minLength: 4)
                Text("fronted \((bill.cents - bill.myCents).dollars.moneyCompact())")
                    .font(F.mono(10)).foregroundStyle(T.faint)
            }
        }
        .padding(14)
        .background(CardSurface(radius: T.radiusSmall + 2))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var namesLine: String {
        let names = bill.shares.compactMap { people[$0.personId]?.name.split(separator: " ").first.map(String.init) }
        if names.isEmpty { return "split" }
        return "with " + (names.count <= 2 ? names.joined(separator: " & ") : "\(names[0]), \(names[1]) +\(names.count - 2)")
    }
}

private struct AvatarStack: View {
    let people: [Summary.Person]

    var body: some View {
        HStack(spacing: -7) {
            ForEach(Array(people.prefix(4).enumerated()), id: \.offset) { _, p in
                PersonAvatar(person: p, size: 22)
                    .background(Circle().fill(T.panel))
                    .overlay(Circle().strokeBorder(T.panel, lineWidth: 1.5))
            }
        }
    }
}

private struct ItemizedChip: View {
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "list.bullet.rectangle").font(.system(size: 8, weight: .semibold))
            Text("BY ITEM").font(F.semibold(8.5)).tracking(0.6)
        }
        .foregroundStyle(T.blue)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(Capsule().fill(T.blue.opacity(0.13)))
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
        let tint = person.cents > 0 ? T.jade : person.cents < 0 ? T.coral : T.muted
        let theirTotal = bills.reduce(0) { acc, b in acc + b.shares.filter { $0.personId == person.id }.reduce(0) { $0 + $1.cents } }

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 14) {
                    PersonAvatar(person: person, size: 56)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(person.name).font(F.display(24)).foregroundStyle(T.paper)
                        Text(person.openCount > 0 ? "\(person.openCount) open bill\(person.openCount == 1 ? "" : "s")" : "nothing open")
                            .font(F.body(12)).foregroundStyle(T.faint)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(person.cents > 0 ? "OWES YOU" : person.cents < 0 ? "YOU OWE" : "BALANCE")
                        .font(F.mono(10)).tracking(1.2).foregroundStyle(T.muted)
                    AnimatedMoney(value: Double(abs(person.cents)) / 100, font: F.display(40), color: person.cents == 0 ? T.muted : T.paper)
                    Text(person.cents == 0 ? "You're all square." : person.lastSettledAt.map { "Last settled \(CompanionFormat.ago(Date(timeIntervalSince1970: TimeInterval($0))))." } ?? "Never settled up.")
                        .font(F.body(12)).foregroundStyle(tint == T.muted ? T.faint : tint)
                }
                .padding(.top, 22)
                .heroGlow(tint)

                if person.cents > 0 {
                    VenmoRequestButton(person: person, cents: person.cents, note: venmoNote(bills))
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
                    Eyebrow("Spotted paybacks").padding(.top, 24).padding(.bottom, 8)
                    VStack(spacing: 8) {
                        ForEach(suggestions) { sg in
                            NoticeBanner(
                                symbol: "checkmark.circle.fill",
                                text: "\(sg.cents.dollars.money()) · \(sg.detail)",
                                tint: T.jade,
                                badge: CompanionFormat.day(sg.ts),
                                chevron: false
                            )
                        }
                    }
                    Text("Confirm it from the Shared tab and the balance updates once your Mac applies it.")
                        .font(F.body(11)).foregroundStyle(T.faint).padding(.top, 6)
                }

                HStack {
                    Eyebrow("Bills together")
                    Spacer()
                    if theirTotal > 0 {
                        Text("their shares \(theirTotal.dollars.money())").font(F.mono(10.5)).foregroundStyle(T.faint)
                    }
                }
                .padding(.top, 26)
                .padding(.bottom, 6)

                if bills.isEmpty {
                    Text("No recent bills with \(person.name.split(separator: " ").first.map(String.init) ?? person.name).")
                        .font(F.body(12.5)).foregroundStyle(T.faint).padding(.vertical, 10)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(bills.enumerated()), id: \.element.id) { i, b in
                            let theirs = b.shares.filter { $0.personId == person.id }.reduce(0) { $0 + $1.cents }
                            HStack(spacing: 12) {
                                MerchantAvatar(name: b.merchant, icon: "Users", size: 34)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(b.merchant).font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                                    Text("\(CompanionFormat.day(b.ts)) · bill \(b.cents.dollars.money())")
                                        .font(F.body(11)).foregroundStyle(T.faint).lineLimit(1)
                                }
                                Spacer(minLength: 6)
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(theirs.dollars.money()).font(F.mono(13)).foregroundStyle(T.paper)
                                    Text("\(Int((Double(theirs) / Double(max(1, b.cents)) * 100).rounded()))% share")
                                        .font(F.mono(9.5)).foregroundStyle(T.faint)
                                }
                            }
                            .padding(.vertical, 10)
                            .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 46) } }
                        }
                    }
                }
            }
            .padding(22)
        }
        .bSheet()
        .sheet(item: $entry) { which in SharedSheetView(which: which, summary: summary) }
    }

    /// "Ippudo, Airbnb · Big Sur" — what the request is for, in their terms.
    private func venmoNote(_ bills: [Summary.SharedExpense]) -> String {
        let names = bills.prefix(3).map(\.merchant)
        return names.isEmpty ? "Shared bills" : names.joined(separator: ", ")
    }
}

/// One bill: who had what, as a ring and a list.
private struct BillSheet: View {
    let bill: Summary.SharedExpense
    let summary: Summary

    var body: some View {
        let people = Dictionary((summary.people ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let slices = billSlices(bill, people)
        let mine = bill.cents > 0 ? Double(bill.myCents) / Double(bill.cents) : 0

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    MerchantAvatar(name: bill.merchant, icon: "Users", size: 44)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(bill.merchant).font(F.display(21)).foregroundStyle(T.paper).lineLimit(1)
                            if bill.itemized == true { ItemizedChip() }
                        }
                        Text(CompanionFormat.weekday(bill.ts)).font(F.body(12)).foregroundStyle(T.faint)
                    }
                }

                HStack(alignment: .center, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("THE BILL").font(F.mono(10)).tracking(1.2).foregroundStyle(T.muted)
                        AnimatedMoney(value: bill.cents.dollars, font: F.display(36))
                        Text("you fronted \((bill.cents - bill.myCents).dollars.money())")
                            .font(F.mono(11.5)).foregroundStyle(T.brass)
                    }
                    Spacer(minLength: 0)
                    MixDonut(slices: slices, size: 104)
                }
                .padding(.top, 20)

                if let note = bill.note {
                    HStack(spacing: 8) {
                        Image(systemName: "text.quote").font(.system(size: 11)).foregroundStyle(T.faint)
                        Text(note).font(F.body(13)).foregroundStyle(T.muted)
                    }
                    .padding(.top, 14)
                }

                Eyebrow("Who had what").padding(.top, 24).padding(.bottom, 6)
                VStack(spacing: 0) {
                    shareRow(avatar: AnyView(PersonAvatar(name: "You", color: T.paper, size: 34)),
                             name: "You", detail: "your share · counts as your spend",
                             cents: bill.myCents, fraction: mine, color: T.paper.opacity(0.8), first: true)
                    ForEach(Array(bill.shares.enumerated()), id: \.offset) { _, sh in
                        let p = people[sh.personId]
                        shareRow(
                            avatar: AnyView(p.map { PersonAvatar(person: $0, size: 34) } ?? PersonAvatar(name: "?", color: T.muted, size: 34)),
                            name: p?.name ?? "Someone",
                            detail: "fronted · held outside your spending",
                            cents: sh.cents,
                            fraction: bill.cents > 0 ? Double(sh.cents) / Double(bill.cents) : 0,
                            color: p.map(PersonAvatar.color(for:)) ?? T.muted,
                            first: false,
                            person: p
                        )
                    }
                }
            }
            .padding(22)
        }
        .bSheet()
    }

    private func shareRow(avatar: AnyView, name: String, detail: String, cents: Int, fraction: Double, color: Color, first: Bool, person: Summary.Person? = nil) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                avatar
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(F.medium(14)).foregroundStyle(T.paper)
                    Text(detail).font(F.body(10.5)).foregroundStyle(T.faint)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(cents.dollars.money()).font(F.mono(13.5)).foregroundStyle(T.paper)
                    Text(CompanionFormat.percent(fraction)).font(F.mono(9.5)).foregroundStyle(T.faint)
                }
                if let person, cents > 0 {
                    VenmoRequestButton(person: person, cents: cents, note: bill.note.map { "\(bill.merchant) — \($0)" } ?? bill.merchant, compact: true)
                }
            }
            SlimMeter(fraction: fraction, color: color, height: 3).padding(.leading, 46)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .top) { if !first { Hairline().padding(.leading, 46) } }
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
