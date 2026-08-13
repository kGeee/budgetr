import { describe, it, expect } from "vitest";
import { cleanDescriptor, softTitleCase } from "@/lib/display-names";

// Every `raw` string below is a real descriptor taken from the ledger, so these
// cases document what the banks actually send rather than what a regex author
// imagined they might.

describe("cleanDescriptor — Zelle", () => {
  it("names the counterparty and keeps the memo", () => {
    expect(cleanDescriptor('Zelle payment to BIEL VALLDOSERA SOCIAS for "Rent"; Conf# ugtyefxk5')).toBe(
      "Zelle → Biel Valldosera Socias · Rent",
    );
  });

  it("handles a payment with no memo", () => {
    expect(cleanDescriptor("Zelle payment to MOHNISH GORANTLA Conf# xwq46u2hq")).toBe(
      "Zelle → Mohnish Gorantla",
    );
  });

  it("distinguishes money coming in", () => {
    expect(cleanDescriptor("Zelle payment from SRIKANTH MADDI Conf# t5a80n52h")).toBe(
      "Zelle ← Srikanth Maddi",
    );
  });
});

describe("cleanDescriptor — ACH DES: records", () => {
  it("keeps originator and entry description, drops the ID fields", () => {
    // INDN carries the account holder's legal name — this is the field that
    // leaked "MR KEVIN GEORGE" onto the Vendors page.
    expect(
      cleanDescriptor(
        "SCHWAB BROKERAGE DES:MONEYLINK ID:XXXXXXXXXX59584 INDN:MR KEVIN GEORGE CO ID:XXXXX86224 WEB",
      ),
    ).toBe("Schwab Brokerage · Moneylink");
  });

  it("drops an entry description that only names the rail", () => {
    expect(
      cleanDescriptor(
        "AMERICAN EXPRESS DES:ACH PMT ID:A4840 INDN:KEVIN GEORGE CO ID:XXXXX33497 WEB",
      ),
    ).toBe("American Express");
  });

  it("keeps a meaningful entry description", () => {
    expect(
      cleanDescriptor(
        "CHASE CREDIT CRD DES:AUTOPAY ID:XXXXXXXXXX08209 INDN:GEORGE KEVIN CO ID:XXXXX39224 PPD",
      ),
    ).toBe("Chase Credit Crd · Autopay");
  });

  it("survives the messiest record in the ledger", () => {
    const out = cleanDescriptor(
      "IRS TREAS 310 DES: TAX REF ID:XXXXXXXXXX00909 INDN:GEORGE, KEVIN CO ID:XXXXX36043 PPD PMT INFO:REF*GEOR*KANSAS*12/2025*TAX REFUND*30\\",
    );
    expect(out).toBe("IRS Treas 310 · Tax Ref");
    expect(out).not.toMatch(/GEORGE|XXXX/);
  });
});

describe("cleanDescriptor — card purchases", () => {
  it("strips the verb, date stamp, masked card digits and state code", () => {
    expect(cleanDescriptor("PURCHASE 0607 GOOGLE ELLATION CA XXXXX3861XXXXXXXXXX5598")).toBe(
      "Google Ellation",
    );
  });

  it("drops a trailing RECURRING flag", () => {
    expect(
      cleanDescriptor("PURCHASE 0601 PATREON MEMBERS CA XXXXX3861XXXXXXXXXX6102 RECURRING"),
    ).toBe("Patreon Members");
  });

  it("handles a peer payment line", () => {
    expect(
      cleanDescriptor("PMNT SENT 0420 APPLE CASH SENT MONEY 1INFINITELOOPCA XXXXX2361XXXXXXXXXX9770"),
    ).toBe("Apple Cash Sent Money 1INFINITELOOPCA");
  });
});

describe("cleanDescriptor — internal transfers and ATMs", () => {
  it("reads Keep the Change as a destination", () => {
    expect(cleanDescriptor("KEEP THE CHANGE TRANSFER TO ACCT 6904 FOR 06/08/26")).toBe(
      "Keep the Change → 6904",
    );
    expect(cleanDescriptor("KEEPTHECHANGE CREDIT FROM ACCT6642 EFFECTIVE 06/08")).toBe(
      "Keep the Change → 6642",
    );
  });

  it("names the account on an online banking transfer", () => {
    expect(cleanDescriptor("Online Banking transfer to CHK 6642 Confirmation# XXXXX16857")).toBe(
      "Transfer → CHK 6642",
    );
    expect(cleanDescriptor("Online Banking transfer from CHK 1337 Confirmation# XXXXX16857")).toBe(
      "Transfer ← CHK 1337",
    );
  });

  it("summarises an ATM withdrawal by location", () => {
    expect(cleanDescriptor("BKOFAMERICA ATM 04/12 #XXXXX4888 WITHDRWL VAN NESS FINANCIAL")).toBe(
      "ATM withdrawal · Van Ness Financial",
    );
  });
});

describe("cleanDescriptor — the safety properties", () => {
  it("leaves an already-clean merchant name untouched", () => {
    // The function runs over every row, so this is the case that matters most.
    for (const name of ["Atlas Cafe", "Amazon Web Services", "Lyft", "Whole Foods", "Macy's"]) {
      expect(cleanDescriptor(name)).toBe(name);
    }
  });

  it("never returns an empty string for a non-empty descriptor", () => {
    for (const raw of ["XXXXXXXXXX59584", "Conf# abc123", "WEB", "   "]) {
      const out = cleanDescriptor(raw);
      if (raw.trim()) expect(out.length).toBeGreaterThan(0);
    }
  });

  it("is idempotent — cleaning a cleaned name changes nothing", () => {
    const raws = [
      'Zelle payment to BIEL VALLDOSERA SOCIAS for "Rent"; Conf# ugtyefxk5',
      "SCHWAB BROKERAGE DES:MONEYLINK ID:XXXXXXXXXX59584 INDN:MR KEVIN GEORGE CO ID:XXXXX86224 WEB",
      "PURCHASE 0607 GOOGLE ELLATION CA XXXXX3861XXXXXXXXXX5598",
      "BKOFAMERICA ATM 04/12 #XXXXX4888 WITHDRWL VAN NESS FINANCIAL",
    ];
    for (const raw of raws) {
      const once = cleanDescriptor(raw);
      expect(cleanDescriptor(once)).toBe(once);
    }
  });
});

describe("softTitleCase", () => {
  it("only touches shouted text", () => {
    expect(softTitleCase("KEVIN GEORGE")).toBe("Kevin George");
    expect(softTitleCase("Atlas Cafe")).toBe("Atlas Cafe");
    expect(softTitleCase("iPhone")).toBe("iPhone");
  });

  it("keeps acronyms and code-like words intact", () => {
    expect(softTitleCase("IRS TREAS 310")).toBe("IRS Treas 310");
    expect(softTitleCase("CHK 6642")).toBe("CHK 6642");
  });
});
