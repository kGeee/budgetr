import XCTest

// The same fixtures as packages/core/src/split/{parse,allocate}.test.ts — the
// Swift port has to produce the TypeScript answers to the cent.

final class ReceiptParserTests: XCTestCase {
    static let ippudo = [
        "$90.00 #FKWV",
        "Aug 16 2026 at 8:42 PM",
        "AKAMARU MODERN × 2 $48.00",
        "($21.00 ea.)",
        "◆TAMAGO ($6.00)",
        "BUNS MEDLEY $16.00",
        "CHICKEN",
        "CHICKEN",
        "CHICKEN",
        "KARA-AGE AKA $13.00",
        "Purchase Subtotal $77.00",
        "Sales Tax (8.625%) $6.64",
        "Tip $6.36",
        "Total $90.00",
    ]

    func testTheIppudoReceipt() {
        let r = ReceiptParser.parseRows(Self.ippudo)
        XCTAssertEqual(r.items.map(\.label), ["AKAMARU MODERN", "BUNS MEDLEY", "KARA-AGE AKA"])
        XCTAssertEqual(r.items[0].quantity, 2)
        XCTAssertEqual(r.items[0].unitPrice, 21)
        XCTAssertEqual(r.items[0].total, 48)
        XCTAssertEqual(r.items[0].modifiers, [ReceiptModifier(label: "◆TAMAGO", price: 6)])
        XCTAssertEqual(r.items[1].modifiers.map(\.label), ["CHICKEN", "CHICKEN", "CHICKEN"])
        XCTAssertEqual(r.subtotal, 77)
        XCTAssertEqual(r.tax, 6.64)
        XCTAssertEqual(r.tip, 6.36)
        XCTAssertEqual(r.total, 90)
        XCTAssertEqual(r.taxRatePct, 8.625)
        XCTAssertNil(r.discrepancy)
    }

    func testHeadlineTotalWithThePriceLast() {
        let r = ReceiptParser.parseRows(["#FKWV $90.00"] + Self.ippudo.dropFirst(2))
        XCTAssertEqual(r.items.map(\.label), ["AKAMARU MODERN", "BUNS MEDLEY", "KARA-AGE AKA"])
        XCTAssertNil(r.discrepancy)
    }

    func testKeepsASingleItemWorthTheWholeBill() {
        XCTAssertEqual(ReceiptParser.parseRows(["OMAKASE $40.00", "Subtotal $40.00", "Total $40.00"]).items.count, 1)
    }

    func testEdgeCases() {
        let bad = ReceiptParser.parseRows(["BURGER $10.00", "FRIES $5.00", "Subtotal $20.00"])
        XCTAssertEqual(bad.discrepancy, .init(itemsTotal: 15, subtotal: 20, difference: -5))
        XCTAssertEqual(ReceiptParser.parseRows(["THING $50.00", "Subtotal $50.00", "Tax $4.00", "Total $60.00"]).tip, 6)
        XCTAssertEqual(ReceiptParser.parseRows(["THING $50.00", "Subtotal $50.00", "Tax $4.00", "Tip $6.00"]).total, 60)
        let both = ReceiptParser.parseRows(["A $1.00", "Purchase Subtotal $1.00", "Total $1.10"])
        XCTAssertEqual(both.subtotal, 1)
        XCTAssertEqual(both.total, 1.1)
        let taco = ReceiptParser.parseRows(["3 × TACO $9.00"]).items[0]
        XCTAssertEqual(taco.label, "TACO")
        XCTAssertEqual(taco.quantity, 3)
        XCTAssertEqual(taco.total, 9)
    }

    func testRowsFromBoxes() {
        // Description and price recognised separately, on the same line.
        let rows = ReceiptParser.groupIntoRows([
            OcrLine(text: "$16.00", x: 0.8, y: 0.30, w: 0.15, h: 0.02),
            OcrLine(text: "BUNS MEDLEY", x: 0.1, y: 0.305, w: 0.3, h: 0.02),
            OcrLine(text: "CHICKEN", x: 0.1, y: 0.34, w: 0.2, h: 0.02),
        ])
        XCTAssertEqual(rows, ["BUNS MEDLEY $16.00", "CHICKEN"])
    }
}

final class ReceiptSplitTests: XCTestCase {
    func testTheRealDinnerSplitsToTheCent() {
        let r = ReceiptParser.parseRows(Array(ReceiptParserTests.ippudo.dropFirst(2)))
        let (a, b, c) = (ReceiptSplit.me, "p_bea", "p_cal")
        let ids = r.items.map(\.id)
        let split = ReceiptSplit.allocate(receipt: r, assignments: [
            ids[0]: [a: 1, b: 1],
            ids[1]: [a: 1, b: 1, c: 1],
            ids[2]: [a: 1, b: 1, c: 1],
        ], participantIds: [a, b, c])
        let by = Dictionary(uniqueKeysWithValues: split.people.map { ($0.participantId, $0) })
        XCTAssertEqual(split.allocated, 90)
        XCTAssertEqual(split.unassigned, 0)
        XCTAssertEqual(by[a]!.total, 39.37)
        XCTAssertEqual(by[b]!.total, 39.34)
        XCTAssertEqual(by[c]!.total, 11.29)
        let buns = [a, b, c].map { id in by[id]!.lines.first { $0.itemId == ids[1] }!.amount }.sorted()
        XCTAssertEqual(buns, [5.33, 5.33, 5.34])
    }

    func testReconcileFoldsAShortReceiptIntoTip() {
        let r = ReceiptParser.parseRows(["THING $60.00", "Subtotal $60.00"])
        let out = ReceiptSplit.reconcile(r, charged: 66.13)
        XCTAssertEqual(out.addedTip, 6.13)
        XCTAssertEqual(ReceiptSplit.receiptTotal(out.receipt), 66.13)
        let long = ReceiptSplit.reconcile(ReceiptParser.parseRows(Array(ReceiptParserTests.ippudo.dropFirst(2))), charged: 83.64)
        XCTAssertEqual(long.pendingCharge, 6.36)
    }

    func testItemsJsonMatchesTheDesktopShape() throws {
        let r = ReceiptParser.parseRows(["TACO $9.00"])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(r)) as! [String: Any]
        XCTAssertTrue(json["tax"] is NSNull, "explicit null, as the TypeScript writes")
        let item = (json["items"] as! [[String: Any]])[0]
        XCTAssertEqual(Set(item.keys), ["id", "label", "quantity", "unitPrice", "total", "modifiers"])
    }
}
