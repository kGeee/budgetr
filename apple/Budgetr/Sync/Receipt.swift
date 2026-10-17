import Foundation

// Receipt text → line items → who owes what, to the cent.
//
// A line-for-line port of `packages/core/src/split/{parse,allocate,cents}.ts`.
// The desktop and the phone must agree on every cent of a split — a bill
// that's a penny different on two devices is the bug nobody reports and
// everybody stops trusting — so the rules, the regexes and the rounding are
// the TypeScript ones, not a reinterpretation. The types encode to the same
// JSON, so `itemsJson` written here reopens on the Mac.

// ── Types (split/types.ts) ───────────────────────────────────────────

/// One recognised run of text, boxed 0…1 with the origin top-left.
struct OcrLine: Equatable {
    let text: String
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct ReceiptModifier: Codable, Equatable {
    var label: String
    var price: Double?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(label, forKey: .label)
        try c.encode(price, forKey: .price)
    }
}

struct ReceiptItem: Codable, Equatable, Identifiable {
    var id: String
    var label: String
    var quantity: Int
    var unitPrice: Double?
    /// The line's own right-hand price — what gets split.
    var total: Double
    var modifiers: [ReceiptModifier]

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(label, forKey: .label)
        try c.encode(quantity, forKey: .quantity)
        try c.encode(unitPrice, forKey: .unitPrice)
        try c.encode(total, forKey: .total)
        try c.encode(modifiers, forKey: .modifiers)
    }
}

struct ParsedReceipt: Codable, Equatable {
    struct Discrepancy: Codable, Equatable {
        let itemsTotal: Double
        let subtotal: Double
        let difference: Double
    }

    var items: [ReceiptItem]
    var subtotal: Double?
    var tax: Double?
    var tip: Double?
    var total: Double?
    var taxRatePct: Double?
    var discrepancy: Discrepancy?
    var unparsed: [String]

    static let empty = ParsedReceipt(items: [], subtotal: nil, tax: nil, tip: nil, total: nil, taxRatePct: nil, discrepancy: nil, unparsed: [])

    // Explicit nulls, as the TypeScript side writes them.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(items, forKey: .items)
        try c.encode(subtotal, forKey: .subtotal)
        try c.encode(tax, forKey: .tax)
        try c.encode(tip, forKey: .tip)
        try c.encode(total, forKey: .total)
        try c.encode(taxRatePct, forKey: .taxRatePct)
        try c.encode(discrepancy, forKey: .discrepancy)
        try c.encode(unparsed, forKey: .unparsed)
    }
}

/// participantId → weight (units eaten). `ReceiptSplit.me` is you.
typealias ItemAssignment = [String: Int]

struct PersonBreakdown: Equatable {
    struct Line: Equatable {
        let itemId: String
        let label: String
        let amount: Double
        let weight: Int
        let of: Int
    }

    let participantId: String
    let items: Double
    let tax: Double
    let tip: Double
    let total: Double
    let lines: [Line]
}

struct ItemizedSplit: Equatable {
    let people: [PersonBreakdown]
    let unassigned: Double
    let unassignedItemIds: [String]
    let allocated: Double
}

// ── Parsing (split/parse.ts) ─────────────────────────────────────────

enum ReceiptParser {
    private static func re(_ p: String, _ opts: NSRegularExpression.Options = []) -> NSRegularExpression {
        // The patterns are constants; a failure here is a programming error.
        try! NSRegularExpression(pattern: p, options: opts)
    }

    private static let trailingMoney = re(#"(\()?\s*(-)?\$?\s?(-)?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\s*(\))?\s*$"#)
    private static let inlineMoney = re(#"\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})"#)
    private static let trailingQty = re(#"\s*[×xX]\s*(\d{1,3})\s*$"#)
    private static let leadingQty = re(#"^\s*(\d{1,3})\s*[×xX]\s+"#)
    private static let unitPrice = re(#"(?:\$\s?(\d+(?:\.\d{2})?)\s*(?:ea\b|each\b))|(?:@\s*\$?\s?(\d+(?:\.\d{2})?))"#, .caseInsensitive)
    private static let unitLead = re(#"^\(?\s*\$?\s?[\d.]+\s*(ea\b|each\b)"#, .caseInsensitive)
    private static let unitWord = re(#"\bea\b|each\b|@"#, .caseInsensitive)
    private static let percent = re(#"\(\s*(\d+(?:\.\d+)?)\s*%\s*\)"#)

    private static let totalKeys: [(key: String, test: NSRegularExpression)] = [
        ("subtotal", re(#"\b(sub[\s-]?total|purchase subtotal|food total|items? total)\b"#)),
        ("tax", re(#"\b(sales tax|tax|vat|gst|hst)\b"#)),
        ("tip", re(#"\b(tip|gratuity|service charge)\b"#)),
        ("total", re(#"\b(grand total|order total|amount due|total)\b"#)),
    ]

    private static let noise = re(#"^(thank you|thanks|customer copy|merchant copy|server|table|guests?|order\s*#|check\s*#|auth|approval|card\b|visa|mastercard|amex|discover|debit|credit|change due|cash|balance due|x{4,}|\*{4,}|-{3,}|={3,})"#)

    /// A match's capture groups, nil where a group didn't take part.
    private struct Match {
        let range: NSRange
        let groups: [String?]
        subscript(_ i: Int) -> String? { i < groups.count ? groups[i] : nil }
    }

    private static func match(_ r: NSRegularExpression, _ s: String) -> Match? {
        let ns = s as NSString
        guard let m = r.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return nil }
        let groups = (0..<m.numberOfRanges).map { i -> String? in
            let rg = m.range(at: i)
            return rg.location == NSNotFound ? nil : ns.substring(with: rg)
        }
        return Match(range: m.range, groups: groups)
    }

    private static func test(_ r: NSRegularExpression, _ s: String) -> Bool { match(r, s) != nil }

    private static func norm(_ s: String) -> String {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        t = t.replacingOccurrences(of: #"[.:•·]+"#, with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return t
    }

    static func round2(_ n: Double) -> Double { (n * 100).rounded() / 100 }

    private static func money(_ m: Match) -> Double {
        let negative = m[2] != nil || m[3] != nil
        let value = Double("\(m[4]!.replacingOccurrences(of: ",", with: "")).\(m[5]!)") ?? 0
        return negative ? -value : value
    }

    private static func prefix(_ s: String, upTo r: NSRange) -> String {
        (s as NSString).substring(to: r.location)
    }

    /// Cluster observations into visual rows by vertical overlap.
    static func groupIntoRows(_ lines: [OcrLine]) -> [String] {
        guard !lines.isEmpty else { return [] }
        let sorted = lines.sorted { $0.y != $1.y ? $0.y < $1.y : $0.x < $1.x }
        var rows: [[OcrLine]] = []
        for line in sorted {
            if let row = rows.last {
                let top = row.map(\.y).min()!
                let bottom = row.map { $0.y + $0.h }.max()!
                let overlap = min(bottom, line.y + line.h) - max(top, line.y)
                let shorter = min(bottom - top, line.h)
                if shorter > 0 && overlap / shorter > 0.5 {
                    rows[rows.count - 1].append(line)
                    continue
                }
            }
            rows.append([line])
        }
        return rows.map { row in
            row.sorted { $0.x < $1.x }
                .map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private struct Row {
        let raw: String
        let label: String
        let amount: Double?
        let parenthesised: Bool
    }

    private static func splitRow(_ raw: String) -> Row {
        guard let m = match(trailingMoney, raw) else {
            return Row(raw: raw, label: raw.trimmingCharacters(in: .whitespaces), amount: nil, parenthesised: false)
        }
        return Row(
            raw: raw,
            label: prefix(raw, upTo: m.range).trimmingCharacters(in: .whitespaces),
            amount: money(m),
            parenthesised: m[1] != nil || m[6] != nil
        )
    }

    static func parse(_ lines: [OcrLine]) -> ParsedReceipt { parseRows(groupIntoRows(lines)) }

    static func parseRows(_ rawRows: [String]) -> ParsedReceipt {
        let rows = rawRows
            .map { $0.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map(splitRow)

        var totals: [String: Double] = [:]
        var taxRatePct: Double?
        var totalRowIdx = Set<Int>()

        for (i, row) in rows.enumerated() {
            guard let amount = row.amount else { continue }
            let label = norm(row.label)
            if label.isEmpty { continue }
            for (key, t) in totalKeys where test(t, label) {
                totals[key] = amount
                totalRowIdx.insert(i)
                if key == "tax", let pct = match(percent, row.label), let v = pct[1] { taxRatePct = Double(v) }
                break
            }
        }

        let firstTotalRow = totalRowIdx.min() ?? rows.count

        var items: [ReceiptItem] = []
        var unparsed: [String] = []
        var pending: ReceiptItem?

        func flush() {
            if let p = pending { items.append(p) }
            pending = nil
        }

        for i in rows.indices {
            if totalRowIdx.contains(i) { continue }
            let row = rows[i]
            let label = norm(row.label)

            if i >= firstTotalRow {
                if row.amount != nil && !label.isEmpty && !test(noise, label) { unparsed.append(row.raw) }
                continue
            }
            if label.isEmpty && row.amount == nil { continue }
            if !label.isEmpty && test(noise, label) { continue }

            let isSubPrice = row.parenthesised && pending != nil

            if let amount = row.amount, !row.label.trimmingCharacters(in: .whitespaces).isEmpty, !isSubPrice {
                flush()
                var name = row.label.trimmingCharacters(in: .whitespaces)
                var quantity = 1
                if let t = match(trailingQty, name) {
                    quantity = Int(t[1] ?? "1") ?? 1
                    name = prefix(name, upTo: t.range).trimmingCharacters(in: .whitespaces)
                } else if let l = match(leadingQty, name) {
                    quantity = Int(l[1] ?? "1") ?? 1
                    name = String(name.dropFirst((l[0] ?? "").count)).trimmingCharacters(in: .whitespaces)
                }
                pending = ReceiptItem(
                    id: "it\(items.count + 1)",
                    label: name.isEmpty ? row.label.trimmingCharacters(in: .whitespaces) : name,
                    quantity: quantity > 0 ? quantity : 1,
                    unitPrice: nil,
                    total: amount,
                    modifiers: []
                )
                continue
            }

            if pending != nil {
                let text = row.raw.trimmingCharacters(in: .whitespaces)
                let unit = match(unitPrice, text)
                let unparen = text.hasPrefix("(") ? String(text.dropFirst()) : text
                if let unit, test(unitLead, unparen) {
                    pending!.unitPrice = Double(unit[1] ?? unit[2] ?? "")
                    continue
                }
                if let unit, pending!.unitPrice == nil, test(unitWord, text) {
                    pending!.unitPrice = Double(unit[1] ?? unit[2] ?? "")
                    continue
                }
                let inline = match(inlineMoney, text)
                let modLabel = text
                    .replacingOccurrences(of: #"\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})"#, with: "", options: .regularExpression, range: inline.map { Range($0.range, in: text)! })
                    .replacingOccurrences(of: #"[()]"#, with: "", options: .regularExpression)
                    .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespaces)
                let price = inline.flatMap { Double("\($0[1]!.replacingOccurrences(of: ",", with: "")).\($0[2]!)") }
                if !modLabel.isEmpty || price != nil {
                    pending!.modifiers.append(ReceiptModifier(label: modLabel, price: price))
                }
                continue
            }
        }
        flush()

        let subtotal = totals["subtotal"], tax = totals["tax"], tip = totals["tip"], total = totals["total"]
        if let total, let subtotal, let tax, tip == nil {
            totals["tip"] = round2(total - subtotal - tax)
        } else if let total, let subtotal, let tip, tax == nil {
            totals["tax"] = round2(total - subtotal - tip)
        } else if let subtotal, let tax, let tip, total == nil {
            totals["total"] = round2(subtotal + tax + tip)
        }

        if items.count > 1, let t = totals["total"], items[0].total == t {
            let rest = round2(items.dropFirst().reduce(0) { $0 + $1.total })
            if totals["subtotal"] == nil || abs(rest - totals["subtotal"]!) < 0.01 { items.removeFirst() }
        }

        let itemsTotal = round2(items.reduce(0) { $0 + $1.total })
        var discrepancy: ParsedReceipt.Discrepancy?
        if let s = totals["subtotal"], abs(itemsTotal - s) >= 0.01 {
            discrepancy = .init(itemsTotal: itemsTotal, subtotal: s, difference: round2(itemsTotal - s))
        }

        return ParsedReceipt(
            items: items,
            subtotal: totals["subtotal"],
            tax: totals["tax"],
            tip: totals["tip"],
            total: totals["total"],
            taxRatePct: taxRatePct,
            discrepancy: discrepancy,
            unparsed: unparsed
        )
    }
}

// ── Allocation (split/allocate.ts, split/cents.ts) ───────────────────

enum ReceiptSplit {
    /// You, in assignment maps — the desktop's `ME`.
    static let me = "__me__"

    private static func toCents(_ n: Double) -> Int { Int((n * 100).rounded()) }

    /// Whole cents across weights, summing exactly — largest remainder, ties
    /// to the earlier participant.
    static func allocateCents(_ totalCents: Int, _ weights: [Int]) -> [Int] {
        let totalWeight = weights.reduce(0, +)
        guard totalWeight > 0 else { return weights.map { _ in 0 } }
        let exact = weights.map { Double(totalCents) * Double($0) / Double(totalWeight) }
        let floors = exact.map { Int($0.rounded(.down)) }
        var leftover = totalCents - floors.reduce(0, +)
        let order = exact.enumerated()
            .map { (i: $0.offset, frac: $0.element - $0.element.rounded(.down)) }
            .sorted { $0.frac != $1.frac ? $0.frac > $1.frac : $0.i < $1.i }
        var out = floors
        var k = 0
        while leftover > 0 {
            out[order[k % order.count].i] += 1
            k += 1
            leftover -= 1
        }
        return out
    }

    static func allocate(receipt: ParsedReceipt, assignments: [String: ItemAssignment], participantIds ids: [String]) -> ItemizedSplit {
        var itemCents = Dictionary(uniqueKeysWithValues: ids.map { ($0, 0) })
        var lines = Dictionary(uniqueKeysWithValues: ids.map { ($0, [PersonBreakdown.Line]()) })
        var unassignedCents = 0
        var unassignedItemIds: [String] = []

        for item in receipt.items {
            let cents = toCents(item.total)
            let weightsById = assignments[item.id] ?? [:]
            let eaters = ids.filter { (weightsById[$0] ?? 0) > 0 }
            if eaters.isEmpty {
                unassignedCents += cents
                unassignedItemIds.append(item.id)
                continue
            }
            let weights = eaters.map { weightsById[$0]! }
            let totalWeight = weights.reduce(0, +)
            let parts = allocateCents(cents, weights)
            for (i, id) in eaters.enumerated() {
                itemCents[id, default: 0] += parts[i]
                lines[id, default: []].append(.init(itemId: item.id, label: item.label, amount: Double(parts[i]) / 100, weight: weights[i], of: totalWeight))
            }
        }

        let assignedWeights = ids.map { itemCents[$0] ?? 0 }
        let assignedTotal = assignedWeights.reduce(0, +)
        let itemsTotalCents = assignedTotal + unassignedCents

        func proratable(_ amount: Double?) -> [Int] {
            let cents = toCents(amount ?? 0)
            if cents == 0 || assignedTotal == 0 { return ids.map { _ in 0 } }
            let share = itemsTotalCents > 0
                ? Int((Double(cents * assignedTotal) / Double(itemsTotalCents)).rounded(.toNearestOrAwayFromZero))
                : cents
            return allocateCents(share, assignedWeights)
        }

        let taxParts = proratable(receipt.tax)
        let tipParts = proratable(receipt.tip)

        let people = ids.enumerated().map { i, id -> PersonBreakdown in
            let items = itemCents[id] ?? 0
            return PersonBreakdown(
                participantId: id,
                items: Double(items) / 100,
                tax: Double(taxParts[i]) / 100,
                tip: Double(tipParts[i]) / 100,
                total: Double(items + taxParts[i] + tipParts[i]) / 100,
                lines: lines[id] ?? []
            )
        }

        let allocated = ReceiptParser.round2(people.reduce(0) { $0 + $1.total })
        let taxTipCents = toCents(receipt.tax ?? 0) + toCents(receipt.tip ?? 0)
        let allocatedTaxTip = taxParts.reduce(0, +) + tipParts.reduce(0, +)

        return ItemizedSplit(
            people: people,
            unassigned: ReceiptParser.round2(Double(unassignedCents + max(0, taxTipCents - allocatedTaxTip)) / 100),
            unassignedItemIds: unassignedItemIds,
            allocated: allocated
        )
    }

    static func assignAllEvenly(_ receipt: ParsedReceipt, _ ids: [String]) -> [String: ItemAssignment] {
        let even = Dictionary(uniqueKeysWithValues: ids.map { ($0, 1) })
        return Dictionary(uniqueKeysWithValues: receipt.items.map { ($0.id, even) })
    }

    static func itemsTotal(_ r: ParsedReceipt) -> Double { ReceiptParser.round2(r.items.reduce(0) { $0 + $1.total }) }

    static func receiptTotal(_ r: ParsedReceipt) -> Double {
        ReceiptParser.round2(itemsTotal(r) + (r.tax ?? 0) + (r.tip ?? 0))
    }

    /// Short receipt → fold the gap into tip. Long receipt → leave it, and
    /// report the gap as a tip still to settle.
    static func reconcile(_ r: ParsedReceipt, charged: Double) -> (receipt: ParsedReceipt, addedTip: Double, pendingCharge: Double) {
        let target = abs(ReceiptParser.round2(charged))
        let gap = ReceiptParser.round2(target - receiptTotal(r))
        if abs(gap) < 0.01 { return (r, 0, 0) }
        if gap > 0 {
            var out = r
            out.tip = ReceiptParser.round2((r.tip ?? 0) + gap)
            out.total = target
            return (out, gap, 0)
        }
        return (r, 0, ReceiptParser.round2(-gap))
    }
}
