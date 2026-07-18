import { describe, it, expect } from "vitest";
import { parseOfx } from "@/lib/import/ofx";
import { canonicalizeOfx, type CanonicalTrade } from "@/lib/import/canonicalize";
import { tradeFingerprint } from "@/lib/import/fingerprint";
import { computeRealizedLots, type LedgerTxn } from "@/lib/tax-lots";

// A realistic OFX 1.x (SGML) brokerage statement: buy 10 AAPL in 2019, sell in 2024.
const OFX1 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<INVSTMTMSGSRSV1><INVSTMTTRNRS>
<TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<INVSTMTRS>
<DTASOF>20240102000000<CURDEF>USD
<INVACCTFROM><BROKERID>schwab.com<ACCTID>1234-5678</INVACCTFROM>
<INVTRANLIST>
<DTSTART>20190101<DTEND>20240102
<BUYSTOCK>
<INVBUY>
<INVTRAN><FITID>T1<DTTRADE>20190102120000<MEMO>Bought 10 AAPL</INVTRAN>
<SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID>
<UNITS>10<UNITPRICE>200.00<COMMISSION>0<FEES>0<TOTAL>-2000.00
</INVBUY>
<BUYTYPE>BUY
</BUYSTOCK>
<SELLSTOCK>
<INVSELL>
<INVTRAN><FITID>T2<DTTRADE>20240102120000<MEMO>Sold 10 AAPL</INVTRAN>
<SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID>
<UNITS>-10<UNITPRICE>240.00<COMMISSION>0<FEES>0<TOTAL>2400.00
</INVSELL>
<SELLTYPE>SELL
</SELLSTOCK>
</INVTRANLIST>
</INVSTMTRS>
</INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST>
<STOCKINFO><SECINFO>
<SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID>
<SECNAME>APPLE INC<TICKER>AAPL
</SECINFO></STOCKINFO>
</SECLIST></SECLISTMSGSRSV1>
</OFX>`;

// OFX 2.x (XML): an option round-trip — buy-to-open then sell-to-close.
const OFX2 = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE"?>
<OFX>
  <INVSTMTMSGSRSV1><INVSTMTTRNRS>
    <TRNUID>1</TRNUID>
    <INVSTMTRS>
      <CURDEF>USD</CURDEF>
      <INVACCTFROM><BROKERID>tastytrade.com</BROKERID><ACCTID>5U1</ACCTID></INVACCTFROM>
      <INVTRANLIST>
        <DTSTART>20240101</DTSTART><DTEND>20240301</DTEND>
        <BUYOPT>
          <INVBUY>
            <INVTRAN><FITID>O1</FITID><DTTRADE>20240105</DTTRADE><MEMO>BTO 2 SPY calls</MEMO></INVTRAN>
            <SECID><UNIQUEID>OPT1</UNIQUEID><UNIQUEIDTYPE>OTHER</UNIQUEIDTYPE></SECID>
            <UNITS>2</UNITS><UNITPRICE>3.00</UNITPRICE><COMMISSION>1.30</COMMISSION><FEES>0.10</FEES>
            <TOTAL>-601.40</TOTAL>
          </INVBUY>
          <OPTBUYTYPE>BUYTOOPEN</OPTBUYTYPE>
        </BUYOPT>
        <SELLOPT>
          <INVSELL>
            <INVTRAN><FITID>O2</FITID><DTTRADE>20240120</DTTRADE><MEMO>STC 2 SPY calls</MEMO></INVTRAN>
            <SECID><UNIQUEID>OPT1</UNIQUEID><UNIQUEIDTYPE>OTHER</UNIQUEIDTYPE></SECID>
            <UNITS>-2</UNITS><UNITPRICE>5.00</UNITPRICE><COMMISSION>1.30</COMMISSION><FEES>0.10</FEES>
            <TOTAL>998.60</TOTAL>
          </INVSELL>
          <OPTSELLTYPE>SELLTOCLOSE</OPTSELLTYPE>
        </SELLOPT>
      </INVTRANLIST>
    </INVSTMTRS>
  </INVSTMTTRNRS></INVSTMTMSGSRSV1>
  <SECLISTMSGSRSV1><SECLIST>
    <OPTINFO><SECINFO>
      <SECID><UNIQUEID>OPT1</UNIQUEID><UNIQUEIDTYPE>OTHER</UNIQUEIDTYPE></SECID>
      <SECNAME>SPY Mar 2024 500 Call</SECNAME><TICKER>SPY   240315C00500000</TICKER>
    </SECINFO>
    <OPTTYPE>CALL</OPTTYPE><STRIKEPRICE>500</STRIKEPRICE><DTEXPIRE>20240315</DTEXPIRE><SHPERCTRCT>100</SHPERCTRCT>
    </OPTINFO>
  </SECLIST></SECLISTMSGSRSV1>
</OFX>`;

/** CanonicalTrade → the engine's LedgerTxn, with the deterministic import id. */
function toLedger(t: CanonicalTrade, accountId = "acct"): LedgerTxn {
  return {
    id: tradeFingerprint({
      accountId,
      date: t.date,
      ticker: t.ticker,
      quantity: t.quantity,
      amount: t.amount,
      side: t.side,
      fitid: t.fitid,
    }),
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

describe("parseOfx — 1.x SGML", () => {
  const doc = parseOfx(OFX1);

  it("reads broker metadata and the transaction date range", () => {
    expect(doc.dialect).toBe("ofx1");
    expect(doc.brokerId).toBe("schwab.com");
    expect(doc.dtStart).toBe("2019-01-01");
    expect(doc.dtEnd).toBe("2024-01-02");
  });

  it("resolves securities by SECID → ticker", () => {
    expect(doc.securities.get("037833100")?.ticker).toBe("AAPL");
  });

  it("extracts the buy and sell with OFX signs and FITIDs", () => {
    expect(doc.transactions).toHaveLength(2);
    const [buy, sell] = doc.transactions;
    expect(buy).toMatchObject({ fitid: "T1", action: "buy", units: 10, total: -2000, date: "2019-01-02" });
    expect(sell).toMatchObject({ fitid: "T2", action: "sell", units: -10, total: 2400, date: "2024-01-02" });
  });
});

describe("canonicalize + engine — SGML equity round-trip", () => {
  it("produces a correct long-term realized gain", () => {
    const trades = canonicalizeOfx(parseOfx(OFX1));
    expect(trades[0]).toMatchObject({ ticker: "AAPL", type: "buy", quantity: 10, amount: 2000, name: "BUY" });
    expect(trades[1]).toMatchObject({ ticker: "AAPL", type: "sell", quantity: -10, amount: -2400 });

    const lots = computeRealizedLots(trades.map((t) => toLedger(t)));
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ quantity: 10, basis: 2000, proceeds: 2400, gain: 400, term: "long" });
  });
});

describe("parseOfx + canonicalize — 2.x XML options", () => {
  const doc = parseOfx(OFX2);

  it("parses XML and carries option open/close intent into name + side", () => {
    expect(doc.dialect).toBe("ofx2");
    const trades = canonicalizeOfx(doc);
    expect(trades[0]).toMatchObject({ name: "BUYTOOPEN", side: "buyToOpen", type: "buy", quantity: 2, isOption: true });
    expect(trades[1]).toMatchObject({ name: "SELLTOCLOSE", side: "sellToClose", type: "sell", quantity: -2 });
  });

  it("stores the full-dollar premium in amount (no ×100 re-multiply) and nets fees via TOTAL", () => {
    const trades = canonicalizeOfx(doc);
    // BTO total −601.40 → +601.40 basis; STC total +998.60 → −998.60 proceeds
    expect(trades[0].amount).toBeCloseTo(601.4, 2);
    expect(trades[1].amount).toBeCloseTo(-998.6, 2);

    const lots = computeRealizedLots(trades.map((t) => toLedger(t)));
    expect(lots).toHaveLength(1);
    expect(lots[0].basis).toBeCloseTo(601.4, 2);
    expect(lots[0].proceeds).toBeCloseTo(998.6, 2);
    expect(lots[0].gain).toBeCloseTo(397.2, 2); // 998.60 − 601.40, fees already netted
    expect(lots[0].term).toBe("short");
  });

  it("uses the broker-supplied OCC-style option ticker", () => {
    const trades = canonicalizeOfx(doc);
    expect(trades[0].ticker).toBe("SPY   240315C00500000".toUpperCase());
  });
});
