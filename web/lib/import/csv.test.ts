import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/import/csv";
import { parseMoney, parseDate, parseSide, csvToCanonical } from "@/lib/import/csv-adapter";
import { detectBroker, resolveMapping } from "@/lib/import/brokers";
import { tradeFingerprint } from "@/lib/import/fingerprint";
import { computeRealizedLots, type LedgerTxn } from "@/lib/tax-lots";

describe("value parsing", () => {
  it("parses money with $, commas, and parentheses-negatives", () => {
    expect(parseMoney("$1,234.56")).toBe(1234.56);
    expect(parseMoney("(2,000.00)")).toBe(-2000);
    expect(parseMoney("-50")).toBe(-50);
    expect(parseMoney("--")).toBeNull();
  });
  it("normalizes dates incl. a trailing time (IBKR)", () => {
    expect(parseDate("2019-01-02")).toBe("2019-01-02");
    expect(parseDate("01/02/2019")).toBe("2019-01-02");
    expect(parseDate("1/2/19")).toBe("2019-01-02");
    expect(parseDate("2019-01-02, 10:00:00")).toBe("2019-01-02");
  });
  it("maps broker action language to a side", () => {
    expect(parseSide("Buy to Open")).toBe("buyToOpen");
    expect(parseSide("SELL TO CLOSE")).toBe("sellToClose");
    expect(parseSide("YOU BOUGHT")).toBe("buy");
    expect(parseSide("Sold")).toBe("sell");
    expect(parseSide("Dividend")).toBeNull();
  });
});

// Schwab-style export, with a preamble line the parser must skip.
const SCHWAB = `"Transactions for account XXXX as of 01/02/2024"

Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount
01/02/2019,Buy,AAPL,APPLE INC,10,$200.00,$0.00,-$2000.00
01/02/2024,Sell,AAPL,APPLE INC,10,$240.00,$0.00,$2400.00
"Total","","","","","","",""`;

// Interactive Brokers-style: signed quantity, no action column, "Date/Time".
const IBKR = `Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee
AAPL,"2019-01-02, 10:00:00",10,200,-2000,-1
AAPL,"2024-01-02, 10:00:00",-10,240,2400,-1`;

function ledger(t: ReturnType<typeof csvToCanonical>["trades"][number]): LedgerTxn {
  return {
    id: tradeFingerprint({ accountId: "a", date: t.date, ticker: t.ticker, quantity: t.quantity, amount: t.amount, side: t.side }),
    date: t.date,
    name: t.name,
    type: t.type,
    quantity: t.quantity,
    amount: t.amount,
    price: t.price,
    fees: t.fees,
    ticker: t.ticker,
  };
}

describe("Schwab CSV (action-based sign)", () => {
  const { headers, rows } = parseCsv(SCHWAB);

  it("skips the preamble, detects the broker, drops the footer total", () => {
    expect(detectBroker(headers)?.key).toBe("schwab");
    expect(rows).toHaveLength(2); // "Total" footer filtered out
  });

  it("normalizes to engine conventions and yields the right realized gain", () => {
    const mapping = resolveMapping(headers, detectBroker(headers)!);
    const { trades } = csvToCanonical(rows, mapping);
    expect(trades[0]).toMatchObject({ ticker: "AAPL", type: "buy", quantity: 10, amount: 2000 });
    expect(trades[1]).toMatchObject({ ticker: "AAPL", type: "sell", quantity: -10, amount: -2400 });

    const lots = computeRealizedLots(trades.map(ledger));
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ quantity: 10, basis: 2000, proceeds: 2400, gain: 400, term: "long" });
  });
});

describe("IBKR CSV (signed-quantity sign)", () => {
  const { headers, rows } = parseCsv(IBKR);

  it("detects IBKR and derives side from the quantity sign", () => {
    const broker = detectBroker(headers);
    expect(broker?.key).toBe("ibkr");
    const { trades } = csvToCanonical(rows, resolveMapping(headers, broker!));
    expect(trades[0]).toMatchObject({ type: "buy", quantity: 10, amount: 2000 });
    expect(trades[1]).toMatchObject({ type: "sell", quantity: -10, amount: 2400 * -1 });
    expect(computeRealizedLots(trades.map(ledger))[0].gain).toBeCloseTo(400, 6);
  });
});

describe("unknown CSV falls through to needing a mapping", () => {
  it("returns no broker for an unrecognized header", () => {
    const { headers } = parseCsv("when,what,ticker,shares,net\n2020-01-01,bought,MSFT,5,-1000");
    expect(detectBroker(headers)).toBeNull();
  });
});
