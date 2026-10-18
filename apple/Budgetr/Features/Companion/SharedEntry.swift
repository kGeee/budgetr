import PhotosUI
import SwiftUI

// Adding to Shared from the phone: split one of your recent purchases with
// people, or record that someone paid you back. Each becomes an op the Mac
// applies through its own split/settle code (see Outbox.swift) — the phone
// works out the cents, the Mac does the accounting.

// ── Split a bill ─────────────────────────────────────────────────────

struct SplitBillSheet: View {
    let summary: Summary
    var preselectedTxnId: String?
    var preselectedPersonId: String?

    @EnvironmentObject private var companion: CompanionStore
    @Environment(\.dismiss) private var dismiss

    @State private var txnId: String?
    @State private var chosen: [String] = []
    @State private var includeMe = true
    @State private var mode = 0 // 0 evenly, 1 custom, 2 by item
    @State private var custom: [String: String] = [:]
    @State private var note = ""
    @State private var sending = false
    @State private var showingAllTxns = false
    @State private var addingPerson = false
    @State private var newName = ""
    @State private var newHandle = ""
    /// Set once sent: who owes what, for the Venmo requests that follow.
    @State private var sent: [(personId: String, cents: Int)]?

    // By item
    @State private var receipt: ParsedReceipt?
    @State private var assignments: [String: ItemAssignment] = [:]
    @State private var brush = ReceiptSplit.me

    private var index: [String: Summary.Category] { CompanionModel.categoryIndex(summary) }
    private var people: [Summary.Person] { companion.knownPeople }

    /// Recent purchases not already split, and not waiting on a split from here.
    private var candidates: [Summary.Txn] {
        let split = Set((summary.shared ?? []).map(\.txnId))
        let queued = Set(companion.pending.compactMap { op -> String? in
            if case .splitBill(let o) = op { return o.txnId } else { return nil }
        })
        return summary.recent
            .filter { CompanionModel.isSpend($0, index) && !split.contains($0.id) && !queued.contains($0.id) }
            .sorted { $0.ts > $1.ts }
    }

    private var txn: Summary.Txn? { summary.recent.first { $0.id == txnId } }
    private var total: Int { abs(txn?.cents ?? 0) }

    // ── By-item arithmetic ───────────────────────────────────────────

    private var participants: [String] { [ReceiptSplit.me] + chosen }

    private var reconciled: (receipt: ParsedReceipt, addedTip: Double, pendingCharge: Double)? {
        guard let receipt, !receipt.items.isEmpty else { return nil }
        return ReceiptSplit.reconcile(receipt, charged: Double(total) / 100)
    }

    private var itemized: ItemizedSplit? {
        guard let r = reconciled else { return nil }
        return ReceiptSplit.allocate(receipt: r.receipt, assignments: assignments, participantIds: participants)
    }

    /// What each chosen person owes, in cents.
    private var shares: [String: Int] {
        guard total > 0, !chosen.isEmpty else { return [:] }
        switch mode {
        case 2:
            guard let itemized else { return [:] }
            return Dictionary(uniqueKeysWithValues: itemized.people
                .filter { $0.participantId != ReceiptSplit.me }
                .map { ($0.participantId, Int(($0.total * 100).rounded())) })
        case 1:
            return Dictionary(uniqueKeysWithValues: chosen.map { ($0, Self.cents(custom[$0] ?? "") ?? 0) })
        default:
            // Evenly: everyone gets the floor; the odd cents stay with you when
            // you're in, or go to the first person when you're not.
            let n = chosen.count + (includeMe ? 1 : 0)
            let each = total / n
            var out = Dictionary(uniqueKeysWithValues: chosen.map { ($0, each) })
            if !includeMe, let first = chosen.first { out[first, default: 0] += total - each * n }
            return out
        }
    }

    /// The figure being split: the charge, or the receipt when it knows more.
    private var basis: Int {
        if mode == 2, let r = reconciled { return Int((ReceiptSplit.receiptTotal(r.receipt) * 100).rounded()) }
        return total
    }

    private var owed: Int { shares.values.reduce(0, +) }
    private var mine: Int { basis - owed }

    private var problem: String? {
        if txn == nil { return "Pick the purchase to split." }
        if chosen.isEmpty { return "Pick who you split it with." }
        if mode == 2 {
            guard let itemized else { return "Scan the receipt, or add its lines." }
            if let r = reconciled, ReceiptPanel.mismatched(pending: r.pendingCharge, charged: total) {
                return "This receipt doesn't look like this purchase."
            }
            if !itemized.unassignedItemIds.isEmpty {
                let n = itemized.unassignedItemIds.count
                return "\(n) line\(n == 1 ? " needs" : "s need") someone."
            }
            if shares.values.allSatisfy({ $0 <= 0 }) { return "Nobody else is on any line." }
            return nil
        }
        if shares.values.contains(where: { $0 <= 0 }) { return "Every share needs an amount." }
        if owed > total { return "The shares add up to more than the bill." }
        return nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let sent {
                    SplitSentView(sent: sent, people: people, merchant: txn?.merchant ?? "", note: note) { dismiss() }
                        .padding(22)
                } else {
                    VStack(alignment: .leading, spacing: 22) {
                        header
                        purchaseSection
                        if txn != nil {
                            peopleSection
                            if !chosen.isEmpty { splitSection }
                            noteSection
                        }
                    }
                    .padding(22)
                    .padding(.bottom, 90)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) { if sent == nil { sendBar } }
            .background(T.panel)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if sent == nil { Button("Cancel") { dismiss() }.foregroundStyle(T.muted) }
                }
            }
        }
        .bSheet([.large])
        .onAppear {
            if txnId == nil { txnId = preselectedTxnId }
            if let p = preselectedPersonId, chosen.isEmpty { chosen = [p] }
        }
        .alert("Someone new", isPresented: $addingPerson) {
            TextField("Name", text: $newName)
            TextField("Venmo @username (optional)", text: $newHandle)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {}
            Button("Add") { addPerson() }
        } message: {
            Text("They're added on your Mac when it next syncs.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow("Shared")
            Text("Split a bill").font(F.display(28)).foregroundStyle(T.paper)
            Text("Your share stays your spending; the rest is held as owed to you until they pay you back.")
                .font(F.body(12.5)).foregroundStyle(T.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // ── Purchase ─────────────────────────────────────────────────────

    @ViewBuilder
    private var purchaseSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Purchase", detail: txn == nil ? "\(candidates.count) recent" : nil,
                          action: txn != nil && preselectedTxnId == nil ? ("Change", { withAnimation(M.settle) { txnId = nil } }) : nil)
            if let txn {
                HStack(spacing: 12) {
                    MerchantAvatar(name: txn.merchant, icon: index[txn.category]?.icon, size: 40)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(txn.merchant).font(F.medium(15)).foregroundStyle(T.paper).lineLimit(1)
                        Text("\(CompanionModel.name(txn.category, index)) · \(CompanionFormat.day(txn.ts))")
                            .font(F.body(11.5)).foregroundStyle(T.faint)
                    }
                    Spacer()
                    Text(total.dollars.money()).font(F.monoSemibold(16)).foregroundStyle(T.paper)
                }
                .padding(14)
                .background(CardSurface(radius: T.radiusSmall))
            } else if candidates.isEmpty {
                Text("No recent purchases to split. The phone sees your Mac's most recent transactions only.")
                    .font(F.body(12.5)).foregroundStyle(T.faint)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array((showingAllTxns ? candidates : Array(candidates.prefix(8))).enumerated()), id: \.element.id) { i, t in
                        Button {
                            Haptics.tick()
                            withAnimation(M.settle) { txnId = t.id }
                        } label: {
                            HStack(spacing: 12) {
                                MerchantAvatar(name: t.merchant, icon: index[t.category]?.icon, size: 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(t.merchant).font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                                    Text(CompanionFormat.day(t.ts)).font(F.body(11)).foregroundStyle(T.faint)
                                }
                                Spacer()
                                Text(abs(t.cents).dollars.money()).font(F.mono(13)).foregroundStyle(T.paper)
                            }
                            .padding(.vertical, 9)
                            .padding(.horizontal, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressScale)
                        .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 58) } }
                    }
                    if candidates.count > 8 && !showingAllTxns {
                        Button {
                            withAnimation(M.settle) { showingAllTxns = true }
                        } label: {
                            Text("Show all \(candidates.count)").font(F.semibold(12.5)).foregroundStyle(T.brass)
                                .frame(maxWidth: .infinity).padding(.vertical, 11)
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .top) { Hairline() }
                    }
                }
                .background(CardSurface(radius: T.radiusSmall))
            }
        }
    }

    // ── People ───────────────────────────────────────────────────────

    private var peopleSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Split with", detail: chosen.isEmpty ? nil : "\(chosen.count)")
            FlowChips(people: people, chosen: $chosen) {
                newName = ""
                newHandle = ""
                addingPerson = true
            }
            if mode != 2 {
                Toggle(isOn: $includeMe.animation(M.settle)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Include me").font(F.medium(14)).foregroundStyle(T.paper)
                        Text(includeMe ? "You keep a share of the bill" : "You paid entirely for others")
                            .font(F.body(11)).foregroundStyle(T.faint)
                    }
                }
                .tint(T.jade)
                .padding(.top, 4)
            }
        }
    }

    private func addPerson() {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        // Someone you already have, by name, is that person — the same rule the
        // Mac applies — so there's never a second Maya.
        if let existing = people.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
            if !chosen.contains(existing.id) { chosen.append(existing.id) }
            if !newHandle.isEmpty, existing.handle == nil { LocalHandles.set(newHandle, for: existing.id) }
            return
        }
        let handle = newHandle
        Task {
            let id = await companion.addPerson(name: name, handle: handle)
            withAnimation(M.snappy) { chosen.append(id) }
            if mode == 2, receipt != nil { brush = id }
        }
    }

    // ── Split ────────────────────────────────────────────────────────

    private var splitSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionHeader(title: "Amounts")
                Segmented(options: [("Evenly", 0), ("Custom", 1), ("By item", 2)], selection: $mode)
                    .frame(width: 228)
            }

            if mode == 2 {
                ReceiptPanel(
                    receipt: $receipt,
                    assignments: $assignments,
                    brush: $brush,
                    participants: participants,
                    people: people,
                    charged: total,
                    reconciled: reconciled,
                    itemized: itemized
                )
            } else {
                StackedBar(slices: slices, height: 8)
                VStack(spacing: 0) {
                    if includeMe || mine > 0 {
                        amountRow(avatar: AnyView(PersonAvatar(name: "You", color: T.paper, size: 32)), name: "You", cents: mine, editable: false, personId: nil)
                    }
                    ForEach(chosen, id: \.self) { id in
                        if let p = people.first(where: { $0.id == id }) {
                            amountRow(avatar: AnyView(PersonAvatar(person: p, size: 32)), name: p.name, cents: shares[id] ?? 0, editable: mode == 1, personId: id)
                                .overlay(alignment: .top) { Hairline().padding(.leading, 44) }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .background(CardSurface(radius: T.radiusSmall))
            }

            HStack {
                Text("They owe you").font(F.body(12)).foregroundStyle(T.muted)
                Spacer()
                Text(owed.dollars.money()).font(F.monoSemibold(13)).foregroundStyle(mode != 2 && owed > total ? T.coral : T.jade)
            }
        }
        .onChange(of: mode) { _, new in
            // Seed custom amounts from the even split, so editing starts from sense.
            if new == 1 {
                let n = chosen.count + (includeMe ? 1 : 0)
                let each = total / max(1, n)
                for id in chosen where (custom[id] ?? "").isEmpty {
                    custom[id] = String(format: "%.2f", Double(each) / 100)
                }
            }
        }
    }

    private var slices: [MixSlice] {
        var out: [MixSlice] = []
        if mine > 0 { out.append(MixSlice(id: "__me", name: "You", value: mine.dollars, color: T.paper.opacity(0.8))) }
        for id in chosen {
            guard let p = people.first(where: { $0.id == id }), let c = shares[id], c > 0 else { continue }
            out.append(MixSlice(id: id, name: p.name, value: c.dollars, color: PersonAvatar.color(for: p)))
        }
        return out
    }

    private func amountRow(avatar: AnyView, name: String, cents: Int, editable: Bool, personId: String?) -> some View {
        HStack(spacing: 12) {
            avatar
            Text(name).font(F.medium(14)).foregroundStyle(T.paper).lineLimit(1)
            Spacer()
            if editable, let personId {
                HStack(spacing: 2) {
                    Text("$").font(F.mono(13.5)).foregroundStyle(T.faint)
                    TextField("0.00", text: Binding(
                        get: { custom[personId] ?? "" },
                        set: { custom[personId] = $0 }
                    ))
                    .font(F.mono(13.5))
                    .foregroundStyle(T.paper)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 80)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(T.ink))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(T.lineStrong, lineWidth: 0.75))
            } else {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(cents.dollars.money()).font(F.mono(13.5)).foregroundStyle(cents < 0 ? T.coral : T.paper)
                    if total > 0 {
                        Text(CompanionFormat.percent(Double(cents) / Double(total))).font(F.mono(9.5)).foregroundStyle(T.faint)
                    }
                }
            }
        }
        .padding(.vertical, 10)
    }

    private var noteSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Note")
            TextField("What was it? (optional)", text: $note)
                .font(F.body(14))
                .foregroundStyle(T.paper)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(T.ink))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(T.line, lineWidth: 0.75))
        }
    }

    // ── Send ─────────────────────────────────────────────────────────

    private var sendBar: some View {
        VStack(spacing: 6) {
            if let problem, txn != nil {
                Text(problem).font(F.body(11.5)).foregroundStyle(T.faint)
            }
            PillButton(title: sending ? "Sending…" : "Split \(basis > 0 ? basis.dollars.money() : "bill")", systemImage: "paperplane.fill", role: .primary) {
                send()
            }
            .disabled(problem != nil || sending)
            .opacity(problem != nil ? 0.45 : 1)
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(T.panel.opacity(0.96))
    }

    private struct ItemsBlob: Encodable {
        let v = 1
        let receipt: ParsedReceipt
        let assignments: [String: ItemAssignment]
    }

    private func send() {
        guard problem == nil, let txn else { return }
        sending = true
        let owedShares = chosen.compactMap { id -> Summary.SharedExpense.Share? in
            guard let c = shares[id], c > 0 else { return nil }
            return .init(personId: id, cents: c)
        }
        var itemsJson: String?
        var basisCents: Int?
        if mode == 2, let r = reconciled {
            itemsJson = (try? JSONEncoder().encode(ItemsBlob(receipt: r.receipt, assignments: assignments)))
                .flatMap { String(data: $0, encoding: .utf8) }
            if basis != total { basisCents = basis }
        }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let op = CompanionOp.splitBill(.init(
            id: CompanionOp.newId(),
            ts: CompanionOp.now(),
            txnId: txn.id,
            shares: owedShares,
            note: trimmed.isEmpty ? nil : trimmed,
            basisCents: basisCents,
            itemsJson: itemsJson
        ))
        Task {
            await companion.submit(op)
            withAnimation(M.settle) {
                sent = owedShares.map { ($0.personId, $0.cents) }
                sending = false
            }
        }
    }

    /// "12.5" / "12,50" / "$12.50" → 1250.
    static func cents(_ text: String) -> Int? {
        let cleaned = text.replacingOccurrences(of: ",", with: ".").filter { "0123456789.".contains($0) }
        guard let v = Double(cleaned), v.isFinite, v >= 0 else { return nil }
        return Int((v * 100).rounded())
    }
}

/// After a split goes out: who owes what, and a Venmo request for each.
private struct SplitSentView: View {
    let sent: [(personId: String, cents: Int)]
    let people: [Summary.Person]
    let merchant: String
    let note: String
    let done: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark")
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(T.onJade)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(T.jade))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Split sent").font(F.display(26)).foregroundStyle(T.paper)
                    Text("Your Mac applies it on its next sync.").font(F.body(12.5)).foregroundStyle(T.muted)
                }
            }
            Eyebrow("Ask for it back")
            VStack(spacing: 0) {
                ForEach(Array(sent.enumerated()), id: \.offset) { i, s in
                    if let p = people.first(where: { $0.id == s.personId }) {
                        HStack(spacing: 12) {
                            PersonAvatar(person: p, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(F.medium(14)).foregroundStyle(T.paper)
                                Text("owes \(s.cents.dollars.money())").font(F.mono(11.5)).foregroundStyle(T.jade)
                            }
                            Spacer()
                            VenmoRequestButton(person: p, cents: s.cents, note: venmoNote, compact: true)
                        }
                        .padding(.vertical, 10)
                        .padding(.horizontal, 12)
                        .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 60) } }
                    }
                }
            }
            .background(CardSurface(radius: T.radiusSmall))
            Text("Venmo opens with the request filled in — you confirm it there. When they pay, budgetr matches it and offers to settle.")
                .font(F.body(11.5)).foregroundStyle(T.faint)
                .fixedSize(horizontal: false, vertical: true)
            PillButton(title: "Done", role: .standard) { done() }
        }
    }

    private var venmoNote: String {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? merchant : "\(merchant) — \(trimmed)"
    }
}

/// The receipt, line by line: scan it, then tap lines to put people on them.
private struct ReceiptPanel: View {
    @Binding var receipt: ParsedReceipt?
    @Binding var assignments: [String: ItemAssignment]
    @Binding var brush: String
    let participants: [String]
    let people: [Summary.Person]
    let charged: Int
    let reconciled: (receipt: ParsedReceipt, addedTip: Double, pendingCharge: Double)?
    let itemized: ItemizedSplit?

    @State private var scanning = false
    @State private var scanNote: String?
    @State private var photo: PhotosPickerItem?
    @State private var showingCamera = false
    @State private var editing: Edit?
    @State private var draftLabel = ""
    @State private var draftAmount = ""

    private enum Edit: Identifiable, Equatable {
        case item(String), newItem, tax, tip
        var id: String {
            switch self {
            case .item(let id): return "item-\(id)"
            case .newItem: return "new"
            case .tax: return "tax"
            case .tip: return "tip"
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if receipt == nil || scanning {
                capture
            } else if let receipt {
                brushRow
                itemsCard(receipt)
                totalsCard
                if let itemized { perPerson(itemized) }
            }
            if let scanNote {
                Text(scanNote).font(F.body(11.5)).foregroundStyle(T.brass)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task { await load(item) }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { image in
                Task { await scan(image) }
            }
            .ignoresSafeArea()
        }
        #endif
        .alert(editTitle, isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            if editing == .newItem || isItemEdit {
                TextField("What was it", text: $draftLabel)
            }
            TextField("0.00", text: $draftAmount)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
            Button("Cancel", role: .cancel) { editing = nil }
            if isItemEdit {
                Button("Remove line", role: .destructive) { removeEditedItem() }
            }
            Button("Save") { saveEdit() }
        }
    }

    // ── Capture ──────────────────────────────────────────────────────

    private var capture: some View {
        VStack(spacing: 12) {
            if scanning {
                HStack(spacing: 10) {
                    ProgressView().tint(T.jade)
                    Text("Reading the receipt on this phone…").font(F.body(13)).foregroundStyle(T.muted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 26)
                .background(CardSurface(radius: T.radiusSmall))
            } else {
                HStack(spacing: 10) {
                    #if os(iOS)
                    captureTile(symbol: "camera.fill", title: "Take a photo", enabled: CameraPicker.isAvailable) {
                        showingCamera = true
                    }
                    #endif
                    PhotosPicker(selection: $photo, matching: .images) {
                        tileLabel(symbol: "photo.on.rectangle", title: "Photo or screenshot", enabled: true)
                    }
                    .buttonStyle(.pressScale)
                }
                Button {
                    Haptics.tap()
                    receipt = .empty
                    editing = .newItem
                    draftLabel = ""
                    draftAmount = ""
                } label: {
                    Text("Or type the lines in").font(F.semibold(12.5)).foregroundStyle(T.brass)
                }
                .buttonStyle(.plain)
                Text("Read on this phone with Apple's text recognition — the picture isn't uploaded anywhere.")
                    .font(F.body(11)).foregroundStyle(T.faint).multilineTextAlignment(.center)
            }
        }
    }

    private func captureTile(symbol: String, title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            tileLabel(symbol: symbol, title: title, enabled: enabled)
        }
        .buttonStyle(.pressScale)
        .disabled(!enabled)
    }

    private func tileLabel(symbol: String, title: String, enabled: Bool) -> some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(enabled ? T.jade : T.faint)
                .frame(width: 46, height: 46)
                .background(Circle().fill(T.jade.opacity(enabled ? 0.14 : 0.05)))
            Text(title).font(F.semibold(12.5)).foregroundStyle(enabled ? T.paper : T.faint)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .background(CardSurface(radius: T.radiusSmall))
        .opacity(enabled ? 1 : 0.6)
    }

    private func load(_ item: PhotosPickerItem) async {
        scanning = true
        defer { photo = nil }
        #if os(iOS)
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
            scanning = false
            scanNote = "Couldn't open that image."
            return
        }
        await scan(image)
        #endif
    }

    #if os(iOS)
    private func scan(_ image: UIImage) async {
        scanning = true
        defer { scanning = false }
        guard let cg = image.uprightCGImage else {
            scanNote = "Couldn't read that image."
            return
        }
        do {
            let parsed = try await ReceiptScanner.scan(cg)
            withAnimation(M.settle) {
                receipt = parsed
                // Everyone on everything is one tap from right for a shared table.
                assignments = ReceiptSplit.assignAllEvenly(parsed, participants)
            }
            if parsed.items.isEmpty {
                scanNote = "Found no priced lines. Try a flatter, closer photo — or add the lines by hand."
            } else if let d = parsed.discrepancy {
                scanNote = "The lines add to \(d.itemsTotal.money()) but the receipt says \(d.subtotal.money()) — tap a line to fix it."
            } else {
                scanNote = nil
            }
            Haptics.success()
        } catch {
            Haptics.error()
            scanNote = "No text found in that picture."
        }
    }
    #endif

    // ── Assign ───────────────────────────────────────────────────────

    private func name(_ id: String) -> String {
        if id == ReceiptSplit.me { return "You" }
        return people.first { $0.id == id }.map { $0.name.split(separator: " ").first.map(String.init) ?? $0.name } ?? "?"
    }

    private func color(_ id: String) -> Color {
        if id == ReceiptSplit.me { return T.paper }
        return people.first { $0.id == id }.map(PersonAvatar.color(for:)) ?? T.muted
    }

    private var brushRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tap the lines for…").font(F.body(11.5)).foregroundStyle(T.faint)
            ScrollView(.horizontal) {
                HStack(spacing: 7) {
                    ForEach(participants, id: \.self) { id in
                        let on = brush == id
                        Button {
                            Haptics.tick()
                            withAnimation(M.snappy) { brush = id }
                        } label: {
                            HStack(spacing: 6) {
                                PersonAvatar(name: name(id), color: color(id), size: 22)
                                Text(name(id)).font(F.semibold(12.5)).foregroundStyle(on ? T.paper : T.muted)
                                if let p = itemized?.people.first(where: { $0.participantId == id }) {
                                    Text(p.total.money()).font(F.mono(10.5)).foregroundStyle(on ? color(id) : T.faint)
                                }
                            }
                            .padding(.leading, 4)
                            .padding(.trailing, 10)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(on ? color(id).opacity(0.18) : T.ink))
                            .overlay(Capsule().strokeBorder(on ? color(id).opacity(0.7) : T.line, lineWidth: on ? 1.2 : 0.75))
                        }
                        .buttonStyle(.pressScale)
                    }
                }
                .padding(.vertical, 1)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func itemsCard(_ receipt: ParsedReceipt) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(receipt.items.enumerated()), id: \.element.id) { i, item in
                itemRow(item)
                    .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 12) } }
            }
            Button {
                Haptics.tap()
                draftLabel = ""
                draftAmount = ""
                editing = .newItem
            } label: {
                Label("Add a line", systemImage: "plus")
                    .font(F.semibold(12.5)).foregroundStyle(T.brass)
                    .frame(maxWidth: .infinity).padding(.vertical, 11)
            }
            .buttonStyle(.plain)
            .overlay(alignment: .top) { Hairline() }
        }
        .background(CardSurface(radius: T.radiusSmall))
    }

    private func itemRow(_ item: ReceiptItem) -> some View {
        let weights = assignments[item.id] ?? [:]
        let on = participants.filter { (weights[$0] ?? 0) > 0 }
        let empty = on.isEmpty
        return Button {
            Haptics.tick()
            toggle(item.id)
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 5) {
                        Text(item.label).font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                        if item.quantity > 1 {
                            Text("×\(item.quantity)").font(F.mono(10.5)).foregroundStyle(T.faint)
                        }
                    }
                    if empty {
                        Text("tap to put \(name(brush)) on it").font(F.body(10.5)).foregroundStyle(T.coral)
                    } else {
                        HStack(spacing: -5) {
                            ForEach(on, id: \.self) { id in
                                PersonAvatar(name: name(id), color: color(id), size: 18)
                                    .background(Circle().fill(T.panel))
                            }
                        }
                    }
                }
                Spacer(minLength: 6)
                Text(item.total.money()).font(F.mono(13)).foregroundStyle(T.paper)
                Image(systemName: (weights[brush] ?? 0) > 0 ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle((weights[brush] ?? 0) > 0 ? color(brush) : T.lineStrong)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .background(empty ? T.coral.opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button { shareEverywhere(item.id) } label: { Label("Everyone shared it", systemImage: "person.3") }
            Button {
                draftLabel = item.label
                draftAmount = String(format: "%.2f", item.total)
                editing = .item(item.id)
            } label: { Label("Edit line", systemImage: "pencil") }
        }
    }

    private func toggle(_ itemId: String) {
        var w = assignments[itemId] ?? [:]
        if (w[brush] ?? 0) > 0 { w[brush] = nil } else { w[brush] = 1 }
        withAnimation(M.snappy) { assignments[itemId] = w }
    }

    private func shareEverywhere(_ itemId: String) {
        withAnimation(M.snappy) {
            assignments[itemId] = Dictionary(uniqueKeysWithValues: participants.map { ($0, 1) })
        }
    }

    // ── Totals ───────────────────────────────────────────────────────

    private var totalsCard: some View {
        let r = reconciled?.receipt ?? receipt ?? .empty
        return VStack(spacing: 0) {
            totalRow("Items", ReceiptSplit.itemsTotal(r).money(), edit: nil)
            totalRow("Tax", (r.tax ?? 0).money(), edit: .tax)
            totalRow("Tip", (r.tip ?? 0).money(), edit: .tip, note: (reconciled?.addedTip ?? 0) > 0 ? "incl. \((reconciled?.addedTip ?? 0).money()) to match the charge" : nil)
            HStack {
                Text("Receipt total").font(F.semibold(13.5)).foregroundStyle(T.paper)
                Spacer()
                Text(ReceiptSplit.receiptTotal(r).money()).font(F.monoSemibold(14)).foregroundStyle(T.paper)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .overlay(alignment: .top) { Hairline() }
            if let pending = reconciled?.pendingCharge, Self.mismatched(pending: pending, charged: charged) {
                Text("This receipt is \(pending.money()) more than the \(charged.dollars.money()) charged — far more than a tip. Check it's the right purchase, or fix a line.")
                    .font(F.body(11)).foregroundStyle(T.coral)
                    .padding(.horizontal, 12).padding(.bottom, 10)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let pending = reconciled?.pendingCharge, pending > 0 {
                Text("Charged \(charged.dollars.money()) so far — the \(pending.money()) tip still has to settle. Friends owe their share of the full receipt.")
                    .font(F.body(11)).foregroundStyle(T.brass)
                    .padding(.horizontal, 12).padding(.bottom, 10)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .background(CardSurface(radius: T.radiusSmall))
    }

    private func totalRow(_ label: String, _ value: String, edit: Edit?, note: String? = nil) -> some View {
        Button {
            guard let edit else { return }
            Haptics.tap()
            let r = receipt ?? .empty
            draftAmount = String(format: "%.2f", edit == .tax ? (r.tax ?? 0) : (r.tip ?? 0))
            editing = edit
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(F.body(13)).foregroundStyle(T.muted)
                    if let note { Text(note).font(F.body(10)).foregroundStyle(T.faint) }
                }
                Spacer()
                Text(value).font(F.mono(12.5)).foregroundStyle(T.paper)
                if edit != nil {
                    Image(systemName: "pencil").font(.system(size: 10)).foregroundStyle(T.faint)
                }
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(edit == nil)
    }

    private func perPerson(_ split: ItemizedSplit) -> some View {
        VStack(spacing: 0) {
            ForEach(split.people, id: \.participantId) { p in
                HStack(spacing: 10) {
                    PersonAvatar(name: name(p.participantId), color: color(p.participantId), size: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(name(p.participantId)).font(F.medium(13.5)).foregroundStyle(T.paper)
                        Text("\(p.items.money()) + \((p.tax + p.tip).money()) tax & tip")
                            .font(F.mono(10)).foregroundStyle(T.faint)
                    }
                    Spacer()
                    Text(p.total.money()).font(F.monoSemibold(13.5))
                        .foregroundStyle(p.participantId == ReceiptSplit.me ? T.paper : T.jade)
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
            }
        }
        .background(RoundedRectangle(cornerRadius: T.radiusSmall, style: .continuous).fill(T.ink))
    }

    /// A receipt over the charge is normal while a tip settles — but not by
    /// this much. Past 40% it's the wrong receipt or a misread line.
    static func mismatched(pending: Double, charged: Int) -> Bool {
        pending > 0.01 && pending > Double(charged) / 100 * 0.4
    }

    // ── Editing ──────────────────────────────────────────────────────

    private var isItemEdit: Bool { if case .item = editing { return true } else { return false } }

    private var editTitle: String {
        switch editing {
        case .newItem: return "Add a line"
        case .item: return "Edit line"
        case .tax: return "Tax"
        case .tip: return "Tip"
        case nil: return ""
        }
    }

    private func saveEdit() {
        let amount = SplitBillSheet.cents(draftAmount).map { Double($0) / 100 }
        var r = receipt ?? .empty
        switch editing {
        case .newItem:
            guard let amount, amount > 0 else { break }
            let next = (r.items.compactMap { Int($0.id.dropFirst(2)) }.max() ?? r.items.count) + 1
            let id = "it\(next)"
            let label = draftLabel.trimmingCharacters(in: .whitespacesAndNewlines)
            r.items.append(ReceiptItem(id: id, label: label.isEmpty ? "Item \(next)" : label, quantity: 1, unitPrice: nil, total: amount, modifiers: []))
            assignments[id] = [brush: 1]
        case .item(let id):
            guard let i = r.items.firstIndex(where: { $0.id == id }) else { break }
            if let amount { r.items[i].total = amount }
            let label = draftLabel.trimmingCharacters(in: .whitespacesAndNewlines)
            if !label.isEmpty { r.items[i].label = label }
        case .tax:
            r.tax = amount
        case .tip:
            r.tip = amount
        case nil:
            break
        }
        // Once a line is touched the printed total is stale; the parts rule.
        r.total = nil
        r.discrepancy = nil
        withAnimation(M.settle) { receipt = r }
        editing = nil
    }

    private func removeEditedItem() {
        guard case .item(let id) = editing, var r = receipt else { return }
        r.items.removeAll { $0.id == id }
        r.total = nil
        r.discrepancy = nil
        assignments[id] = nil
        withAnimation(M.settle) { receipt = r }
        editing = nil
    }
}

/// People as toggle chips that wrap onto as many lines as they need.
private struct FlowChips: View {
    let people: [Summary.Person]
    @Binding var chosen: [String]
    var onAdd: (() -> Void)?

    var body: some View {
        WrapLayout(spacing: 8) {
            ForEach(people) { p in
                let on = chosen.contains(p.id)
                let color = PersonAvatar.color(for: p)
                Button {
                    Haptics.tick()
                    withAnimation(M.snappy) {
                        if on { chosen.removeAll { $0 == p.id } } else { chosen.append(p.id) }
                    }
                } label: {
                    HStack(spacing: 7) {
                        // The tick rides the avatar, so choosing someone never
                        // changes a chip's width and reflows the row.
                        PersonAvatar(person: p, size: 24)
                            .overlay {
                                if on {
                                    Circle().fill(color)
                                    Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundStyle(T.onJade)
                                }
                            }
                        Text(p.name.split(separator: " ").first.map(String.init) ?? p.name)
                            .font(F.semibold(13))
                            .foregroundStyle(on ? T.paper : T.muted)
                    }
                    .padding(.leading, 4)
                    .padding(.trailing, 12)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(on ? color.opacity(0.16) : T.ink))
                    .overlay(Capsule().strokeBorder(on ? color.opacity(0.6) : T.line, lineWidth: on ? 1 : 0.75))
                }
                .buttonStyle(.pressScale)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
            if let onAdd {
                Button {
                    Haptics.tap()
                    onAdd()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                        Text("Someone new").font(F.semibold(13))
                    }
                    .foregroundStyle(T.brass)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().strokeBorder(T.brass.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                }
                .buttonStyle(.pressScale)
            }
        }
    }
}

/// A plain flow layout: left to right, wrapping at the proposed width.
struct WrapLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                y += row + spacing
                x = 0
                row = 0
            }
            x += size.width + spacing
            row = max(row, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += row + spacing
                x = bounds.minX
                row = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

// ── Record a payback ─────────────────────────────────────────────────

struct RecordPaybackSheet: View {
    let summary: Summary
    var preselectedPersonId: String?

    @EnvironmentObject private var companion: CompanionStore
    @Environment(\.dismiss) private var dismiss

    @State private var personId: String?
    @State private var amount = ""
    @State private var depositId: String?
    @State private var sending = false

    private var index: [String: Summary.Category] { CompanionModel.categoryIndex(summary) }
    private var people: [Summary.Person] { companion.knownPeople.sorted { $0.cents > $1.cents } }
    private var person: Summary.Person? { people.first { $0.id == personId } }

    /// Recent money in that isn't income — the Venmo/Zelle/Apple Cash that
    /// paybacks usually arrive as. Linking one keeps it out of your income.
    private var deposits: [Summary.Txn] {
        summary.recent
            .filter { $0.cents > 0 && !CompanionModel.isIncome($0, index) && !$0.merchant.uppercased().contains("AUTOPAY") }
            .sorted { $0.ts > $1.ts }
    }

    private var cents: Int? { SplitBillSheet.cents(amount) }

    private var problem: String? {
        if person == nil { return "Pick who paid you." }
        guard let cents, cents > 0 else { return "Enter how much." }
        return nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 6) {
                        Eyebrow("Shared")
                        Text("Record a payback").font(F.display(28)).foregroundStyle(T.paper)
                        Text("Settles what they owe. Link the deposit it arrived as, and it stays out of your income.")
                            .font(F.body(12.5)).foregroundStyle(T.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeader(title: "From")
                        if people.isEmpty {
                            Text("No people yet — add them on your Mac.").font(F.body(12.5)).foregroundStyle(T.faint)
                        }
                        VStack(spacing: 0) {
                            ForEach(Array(people.enumerated()), id: \.element.id) { i, p in
                                Button {
                                    Haptics.tick()
                                    withAnimation(M.snappy) {
                                        personId = p.id
                                        if amount.isEmpty || depositId == nil, p.cents > 0 {
                                            amount = String(format: "%.2f", p.cents.dollars)
                                        }
                                    }
                                } label: {
                                    HStack(spacing: 12) {
                                        PersonAvatar(person: p, size: 34)
                                        Text(p.name).font(F.medium(14)).foregroundStyle(T.paper)
                                        Spacer()
                                        Text(p.cents > 0 ? "owes \(p.cents.dollars.money())" : p.cents < 0 ? "you owe \(abs(p.cents).dollars.money())" : "settled")
                                            .font(F.mono(11.5))
                                            .foregroundStyle(p.cents > 0 ? T.jade : p.cents < 0 ? T.coral : T.faint)
                                        Image(systemName: personId == p.id ? "checkmark.circle.fill" : "circle")
                                            .font(.system(size: 17))
                                            .foregroundStyle(personId == p.id ? T.jade : T.lineStrong)
                                    }
                                    .padding(.vertical, 9)
                                    .padding(.horizontal, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.pressScale)
                                .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 58) } }
                            }
                        }
                        .background(CardSurface(radius: T.radiusSmall))
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeader(title: "Amount")
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("$").font(F.display(30)).foregroundStyle(T.faint)
                            TextField("0.00", text: $amount)
                                .font(F.display(40))
                                .foregroundStyle(T.paper)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(T.ink))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(T.lineStrong, lineWidth: 0.75))
                        if let person, let cents, person.cents > 0, cents != person.cents {
                            Text(cents < person.cents
                                 ? "Leaves \((person.cents - cents).dollars.money()) still owed."
                                 : "That's \((cents - person.cents).dollars.money()) more than they owe.")
                                .font(F.body(11.5)).foregroundStyle(cents < person.cents ? T.faint : T.brass)
                        }
                    }

                    if !deposits.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeader(title: "Arrived as", detail: "optional")
                            VStack(spacing: 0) {
                                ForEach(Array(deposits.prefix(6).enumerated()), id: \.element.id) { i, t in
                                    Button {
                                        Haptics.tick()
                                        withAnimation(M.snappy) {
                                            if depositId == t.id {
                                                depositId = nil
                                            } else {
                                                depositId = t.id
                                                amount = String(format: "%.2f", t.cents.dollars)
                                            }
                                        }
                                    } label: {
                                        HStack(spacing: 12) {
                                            MerchantAvatar(name: t.merchant, icon: index[t.category]?.icon, size: 32)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(t.merchant).font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                                                Text(CompanionFormat.day(t.ts)).font(F.body(11)).foregroundStyle(T.faint)
                                            }
                                            Spacer()
                                            Text("+\(t.cents.dollars.money())").font(F.mono(12.5)).foregroundStyle(T.jade)
                                            Image(systemName: depositId == t.id ? "link.circle.fill" : "link.circle")
                                                .font(.system(size: 17))
                                                .foregroundStyle(depositId == t.id ? T.jade : T.lineStrong)
                                        }
                                        .padding(.vertical, 9)
                                        .padding(.horizontal, 12)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.pressScale)
                                    .overlay(alignment: .top) { if i > 0 { Hairline().padding(.leading, 56) } }
                                }
                            }
                            .background(CardSurface(radius: T.radiusSmall))
                        }
                    }
                }
                .padding(22)
                .padding(.bottom, 90)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 6) {
                    if let problem { Text(problem).font(F.body(11.5)).foregroundStyle(T.faint) }
                    PillButton(title: sending ? "Sending…" : "Record \(cents.map { $0.dollars.money() } ?? "payback")", systemImage: "checkmark", role: .primary) {
                        send()
                    }
                    .disabled(problem != nil || sending)
                    .opacity(problem != nil ? 0.45 : 1)
                }
                .padding(.horizontal, 22)
                .padding(.top, 10)
                .padding(.bottom, 6)
                .background(T.panel.opacity(0.96))
            }
            .background(T.panel)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(T.muted)
                }
            }
        }
        .bSheet([.large])
        .onAppear {
            if personId == nil, let p = preselectedPersonId ?? people.first(where: { $0.cents > 0 })?.id {
                personId = p
                if let owed = people.first(where: { $0.id == p })?.cents, owed > 0 {
                    amount = String(format: "%.2f", owed.dollars)
                }
            }
        }
    }

    private func send() {
        guard problem == nil, let personId, let cents else { return }
        sending = true
        let op = CompanionOp.recordSettlement(.init(
            id: CompanionOp.newId(), ts: CompanionOp.now(), personId: personId, cents: cents, txnId: depositId
        ))
        Task {
            await companion.submit(op)
            dismiss()
        }
    }
}

// ── Pending ──────────────────────────────────────────────────────────

/// An edit on its way to the Mac, described in the user's terms.
struct PendingOpRow: View {
    let op: CompanionOp
    let summary: Summary
    var people: [Summary.Person] = []
    let onDiscard: () -> Void

    var body: some View {
        let d = describe()
        HStack(spacing: 11) {
            Image(systemName: d.symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(T.brass)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(T.brass.opacity(0.14)))
            VStack(alignment: .leading, spacing: 2) {
                Text(d.title).font(F.medium(13.5)).foregroundStyle(T.paper).lineLimit(1)
                HStack(spacing: 5) {
                    ProgressView().controlSize(.mini).tint(T.faint)
                    Text("waiting for your Mac").font(F.body(11)).foregroundStyle(T.faint)
                }
            }
            Spacer(minLength: 6)
            Text(d.amount).font(F.mono(12.5)).foregroundStyle(T.paper)
            Menu {
                Button("Cancel this edit", role: .destructive) { onDiscard() }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(T.faint)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(T.panel.opacity(0.85)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(T.brass.opacity(0.3), style: StrokeStyle(lineWidth: 0.75, dash: [4, 3])))
        .accessibilityElement(children: .combine)
    }

    private func describe() -> (symbol: String, title: String, amount: String) {
        let people = self.people.isEmpty ? (summary.people ?? []) : self.people
        func first(_ id: String) -> String {
            people.first { $0.id == id }.map { $0.name.split(separator: " ").first.map(String.init) ?? $0.name } ?? "someone"
        }
        switch op {
        case .splitBill(let o):
            let merchant = summary.recent.first { $0.id == o.txnId }?.merchant ?? "a purchase"
            let names = o.shares.map { first($0.personId) }
            return ("person.2", "Split \(merchant) with \(names.joined(separator: ", "))",
                    o.shares.reduce(0) { $0 + $1.cents }.dollars.money())
        case .recordSettlement(let o):
            return ("arrow.down.left", "\(first(o.personId)) paid you back", o.cents.dollars.money())
        case .addPerson(let o):
            return ("person.badge.plus", "Add \(o.name)", o.handle.flatMap(VenmoRequest.recipient).map { "@\($0)" } ?? "")
        }
    }
}
