import XCTest

/// Moving a synced position with a live quote: live = synced × live ÷ price at sync.
final class LivePricingTests: XCTestCase {
    private func summary(px: [Summary.PositionPx]?) throws -> Summary {
        let json = """
        {"v":2,"asOf":1750000000,"appliedOpIds":[],
         "netWorth":{"cents":10000000,"spark":[]},
         "accounts":[],"budgets":[],"recent":[],"alerts":[],
         "positions":[
           {"symbol":"VTI","cents":4000000,"dayBp":50,"pnlCents":500000,"qtyLabel":"160","sector":"Index fund"},
           {"symbol":"AAPL","cents":2000000,"qtyLabel":"100","sector":"Technology"},
           {"symbol":"NVDA","cents":1000000,"sector":"Technology"}
         ],
         "investments":{"valueCents":7000000,"spark":[],"sectors":[
           {"sector":"Index fund","cents":4000000},{"sector":"Technology","cents":3000000}]}}
        """
        var s = try JSONDecoder().decode(Summary.self, from: Data(json.utf8))
        s.positionPx = px
        return s
    }

    func testWithoutPricesOrQuotesNothingMoves() throws {
        let noPx = try summary(px: nil)
        XCTAssertEqual(CompanionModel.reprice(noPx, quotes: ["VTI": .init(price: 300, previousClose: nil)]).summary, noPx)

        let s = try summary(px: [.init(symbol: "VTI", micros: 250_000_000)])
        let book = CompanionModel.reprice(s, quotes: [:])
        XCTAssertFalse(book.isLive)
        XCTAssertEqual(book.summary, s)
    }

    func testAPositionFollowsItsQuote() throws {
        // 160 shares at $250 = $40,000; at $255 that is $40,800.
        let s = try summary(px: [.init(symbol: "VTI", micros: 250_000_000), .init(symbol: "AAPL", micros: 200_000_000)])
        let book = CompanionModel.reprice(s, quotes: ["VTI": .init(price: 255, previousClose: 250)])

        XCTAssertEqual(book.live, ["VTI"])
        XCTAssertEqual(book.total, 3)
        XCTAssertEqual(book.deltaCents, 80_000)

        let vti = try XCTUnwrap(book.summary.positions.first { $0.symbol == "VTI" })
        XCTAssertEqual(vti.cents, 4_080_000)
        XCTAssertEqual(vti.dayBp, 200)          // from the quote's own close
        XCTAssertEqual(vti.pnlCents, 580_000)   // basis is fixed, so P&L moves with value

        // Everything that hangs off the portfolio moves by the same amount.
        XCTAssertEqual(book.summary.netWorth.cents, 10_080_000)
        XCTAssertEqual(book.summary.investments?.valueCents, 7_080_000)
        XCTAssertEqual(book.summary.investments?.sectors.first { $0.sector == "Index fund" }?.cents, 4_080_000)
        XCTAssertEqual(book.summary.investments?.sectors.first { $0.sector == "Technology" }?.cents, 3_000_000)
    }

    func testAPositionTheMacDidNotPriceKeepsItsSyncedValue() throws {
        // NVDA has no positionPx (say it has option legs folded in): a quote
        // for the ticker must not rescale it.
        let s = try summary(px: [.init(symbol: "AAPL", micros: 200_000_000)])
        let book = CompanionModel.reprice(s, quotes: [
            "AAPL": .init(price: 190, previousClose: nil),
            "NVDA": .init(price: 999, previousClose: nil),
        ])
        XCTAssertEqual(book.live, ["AAPL"])
        XCTAssertEqual(book.summary.positions.first { $0.symbol == "NVDA" }?.cents, 1_000_000)
        XCTAssertEqual(book.summary.positions.first { $0.symbol == "AAPL" }?.cents, 1_900_000)
        XCTAssertNil(book.summary.positions.first { $0.symbol == "AAPL" }?.dayBp) // no close, Mac sent none
        XCTAssertEqual(book.deltaCents, -100_000)
    }

    func testPositionsStayOrderedByValueAndBadQuotesAreIgnored() throws {
        let s = try summary(px: [.init(symbol: "VTI", micros: 250_000_000), .init(symbol: "AAPL", micros: 200_000_000)])
        let book = CompanionModel.reprice(s, quotes: [
            "AAPL": .init(price: 500, previousClose: nil), // $50,000 — now the largest
            "VTI": .init(price: 0, previousClose: nil),
        ])
        XCTAssertEqual(book.summary.positions.map(\.symbol), ["AAPL", "VTI", "NVDA"])
        XCTAssertEqual(book.live, ["AAPL"])
    }

    func testTheTapeIsTheFullLedgerWhenTheMacSendsOne() throws {
        var s = try summary(px: nil)
        XCTAssertFalse(s.hasFullLedger)
        XCTAssertEqual(s.tape, s.recent) // an older Mac: the capped tape stands

        let json = #"[{"id":"a","ts":1750000000,"merchant":"Cafe","cents":-450,"category":"cat_food","pending":false},{"id":"b","ts":1749000000,"merchant":"Pay","cents":200000,"category":"cat_income","pending":false}]"#
        s.ledger = try JSONDecoder().decode([Summary.Txn].self, from: Data(json.utf8))
        XCTAssertTrue(s.hasFullLedger)
        XCTAssertEqual(s.tape.map(\.id), ["a", "b"])
        // And it survives a round trip through the cache encoding.
        let back = try JSONDecoder().decode(Summary.self, from: JSONEncoder().encode(s))
        XCTAssertEqual(back.ledger?.count, 2)
    }

    func testOlderPayloadsDecodeWithoutThePrices() throws {
        XCTAssertNil(try summary(px: nil).positionPx)
    }
}
