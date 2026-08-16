/**
 * Turning bank descriptors into something a person can read.
 *
 * Banks don't send merchant names — they send settlement records. The widest
 * row on the Overview page is currently
 *
 *   Zelle Transfer CONF# Z5TMVDJRT; Biel Valldosera Socias
 *
 * and the top row of the Vendors list is
 *
 *   SCHWAB BROKERAGE DES:MONEYLINK ID:XXXXXXXXXX59584 INDN:MR KEVIN GEORGE CO ID:XXXXX86224 WEB
 *
 * Both are the raw NACHA/Zelle strings, and both are ranked, grouped and
 * displayed as if they were merchant names.
 *
 * The rules below are ordered most-specific-first and were written against the
 * descriptor shapes actually present in the ledger — ACH `DES:` records, Zelle
 * payments, card-network purchase lines, ATM withdrawals and Bank of America's
 * own internal transfers. Anything that matches none of them still goes through
 * the generic pass, which strips masked account runs and confirmation numbers
 * and title-cases shouted text. That fallback can't produce a *wrong* name, only
 * a less-improved one, which is the right failure mode for a ledger: this
 * function is presentation only and never feeds matching, grouping or storage.
 *
 * Pure and dependency-free so it can run in either a server or client component.
 */

/** Runs of masked digits banks pad IDs with: XXXXX16857, XXXXXXXXXX5598. */
const MASKED = /\bX{3,}[\dX]*\b/gi;
/** Confirmation numbers, in each of the spellings seen. */
const CONFIRMATION = /\b(?:conf|confirmation)#?\s*[:#]?\s*\S+/gi;
/** ACH entry-class and channel codes that trail a descriptor. */
const TRAILING_CODES = /\b(?:WEB|PPD|CCD|TEL|ARC|POS|RECURRING|PMT INFO:.*)$/i;
/** A leading transaction-type verb plus its MMDD date stamp. */
const CARD_PREFIX = /^(?:PURCHASE|PMNT SENT|PMNT RCVD|CHECKCARD|DEBIT CARD|CREDIT CARD)\s+\d{4}\s+/i;
/** Trailing US state code, which card networks append to the merchant city. */
const TRAILING_STATE = /\s+(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/;

/** Words kept as-is when title-casing, because lower-casing them reads worse. */
const KEEP_UPPER = new Set([
  "ACH",
  "ATM",
  "IRS",
  "USA",
  "US",
  "LLC",
  "INC",
  "CO",
  "ID",
  "CHK",
  "SAV",
  "POS",
  "TV",
  "DVD",
  "HSA",
  "IRA",
]);

const SHOUTING = /^[^a-z]*$/;

/** Title-case a shouted string, leaving mixed-case text and code-like words alone. */
export function softTitleCase(text: string): string {
  if (!SHOUTING.test(text)) return text;
  return text
    .split(/\s+/)
    .map((word) => {
      const bare = word.replace(/[^A-Z0-9#]/gi, "");
      if (KEEP_UPPER.has(bare)) return word;
      // Anything carrying a digit is an account fragment or a date — leave it.
      if (/\d/.test(word)) return word;
      return word.replace(
        /[A-Za-z']+/g,
        (w) => w[0].toUpperCase() + w.slice(1).toLowerCase(),
      );
    })
    .join(" ");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Strip trailing punctuation left behind after removing an ID or code. */
const trimJunk = (s: string) => squash(s).replace(/^[\s;:,·\-–—]+|[\s;:,·\-–—]+$/g, "");

export type ParsedDescriptor = {
  name: string;
  /**
   * True when one of the specific grammars below matched, rather than the
   * generic strip-and-title-case fallback.
   *
   * This matters to callers that chain another cleaner afterwards: the legacy
   * `cleanTransactionName` pass deletes standalone numbers, which is right for
   * "SQ *BLUE BOTTLE 00123" and wrong for "Keep the Change → 6904" or
   * "IRS Treas 310". A specific match means the output is already final.
   */
  matched: boolean;
};

/**
 * A readable name for a bank descriptor, plus whether a specific rule produced
 * it. Most callers want `cleanDescriptor`.
 */
export function parseDescriptor(raw: string): ParsedDescriptor {
  const input = squash(raw);
  if (!input) return { name: input, matched: false };

  // ── Zelle ────────────────────────────────────────────────────────────────
  // "Zelle payment to BIEL VALLDOSERA SOCIAS for "Rent"; Conf# ugtyefxk5"
  // The counterparty is the name you'd recognise; the memo is worth keeping
  // because it's the only place the *reason* for a person-to-person payment
  // is ever recorded.
  const zelle = input.match(
    /^zelle\s+(?:payment|transfer)\s+(to|from)\s+(.+?)(?:\s+for\s+"([^"]*)")?[\s;,]*(?:conf(?:irmation)?#.*)?$/i,
  );
  if (zelle) {
    const [, direction, party, memo] = zelle;
    const who = softTitleCase(trimJunk(party));
    const arrow = direction.toLowerCase() === "from" ? "←" : "→";
    return { name: memo ? `Zelle ${arrow} ${who} · ${memo}` : `Zelle ${arrow} ${who}`, matched: true };
  }

  // ── ACH, the `DES:` grammar ──────────────────────────────────────────────
  // "SCHWAB BROKERAGE DES:MONEYLINK ID:… INDN:… CO ID:… WEB"
  // Originator before DES:, entry description after it. The ID/INDN/CO ID
  // fields are the payer's own masked account and legal name — never useful,
  // and INDN is the one field that leaks a full name into the UI.
  const ach = input.match(/^(.+?)\s+DES:\s*([^:]*?)(?:\s+(?:ID|INDN|CO ID):.*)?$/i);
  if (ach) {
    const originator = softTitleCase(trimJunk(ach[1]));
    const entry = trimJunk(ach[2].replace(/\b(?:ID|INDN|CO)\b.*$/i, ""));
    // "ACH PMT" and friends describe the rail, not the payment — drop them.
    const meaningful = /^(?:ACH\s*(?:PMT|PAYMENT)?|PAYMENT|PMT|TRANSFER|DEPOSIT)$/i.test(entry)
      ? ""
      : softTitleCase(entry);
    return { name: meaningful ? `${originator} · ${meaningful}` : originator, matched: true };
  }

  // ── Bank of America's internal transfers ─────────────────────────────────
  const keepTheChange = input.match(/^KEEP\s?THE\s?CHANGE\b.*?\bACCT\s?(\d+)/i);
  if (keepTheChange) return { name: `Keep the Change → ${keepTheChange[1]}`, matched: true };

  const onlineTransfer = input.match(
    /^online\s+banking\s+transfer\s+(to|from)\s+(.+?)(?:\s+confirmation#.*)?$/i,
  );
  if (onlineTransfer) {
    const arrow = onlineTransfer[1].toLowerCase() === "from" ? "←" : "→";
    return { name: `Transfer ${arrow} ${softTitleCase(trimJunk(onlineTransfer[2]))}`, matched: true };
  }

  // ── ATM ──────────────────────────────────────────────────────────────────
  // "BKOFAMERICA ATM 04/12 #XXXXX4888 WITHDRWL VAN NESS FINANCIAL"
  const atm = input.match(/\bATM\b.*?\b(WITHDRWL|WITHDRAWAL|DEPOSIT)\b\s*(.*)$/i);
  if (atm) {
    const kind = /deposit/i.test(atm[1]) ? "ATM deposit" : "ATM withdrawal";
    const where = trimJunk(atm[2].replace(MASKED, ""));
    return { name: where ? `${kind} · ${softTitleCase(where)}` : kind, matched: true };
  }

  // ── Card-network purchase lines ──────────────────────────────────────────
  // "PURCHASE 0607 GOOGLE ELLATION CA XXXXX3861XXXXXXXXXX5598"
  if (CARD_PREFIX.test(input)) {
    let rest = input.replace(CARD_PREFIX, "");
    rest = rest.replace(MASKED, "");
    rest = trimJunk(rest).replace(/\bRECURRING\b\s*$/i, "");
    rest = trimJunk(rest).replace(TRAILING_STATE, "");
    return { name: softTitleCase(trimJunk(rest)) || input, matched: true };
  }

  // ── Generic pass ─────────────────────────────────────────────────────────
  let out = input.replace(CONFIRMATION, "").replace(MASKED, "");
  out = trimJunk(out).replace(TRAILING_CODES, "");
  out = trimJunk(out);
  return { name: softTitleCase(out) || input, matched: false };
}

/** A readable name for a bank descriptor. Safe to apply to every row. */
export function cleanDescriptor(raw: string): string {
  return parseDescriptor(raw).name;
}
