/**
 * OFX / QFX reader — the structured backbone of trade import.
 *
 * Handles both dialects with one tokenizer:
 *  - OFX 1.x is SGML: leaf tags are NOT closed (`<DTTRADE>20190102<...`),
 *    aggregates are (`<INVBUY>…</INVBUY>`).
 *  - OFX 2.x is XML: everything is closed.
 * QFX is OFX plus Intuit `<INTU.*>` tags — same structure, so it parses here too.
 *
 * We parse into a loose tag tree, then pull out the securities list (SECLIST) and
 * the investment transaction list (INVTRANLIST). Nothing here knows about the
 * budgetr schema — canonicalize.ts maps this neutral shape onto engine rows.
 */

// A parsed node: a leaf string, or an aggregate whose children are nodes (a
// repeated tag becomes an array).
type OfxNode = string | { [tag: string]: OfxNode | OfxNode[] };

export type OfxSecurity = {
  uniqueId: string;
  ticker: string | null;
  name: string | null;
  kind: "stock" | "option" | "mf" | "debt" | "other";
  option?: {
    type: "CALL" | "PUT" | null;
    strike: number | null;
    expiry: string | null; // YYYY-MM-DD
    sharesPerContract: number | null;
  };
};

export type OfxTxn = {
  fitid: string | null;
  /** Coarse action; option open/close intent is in `optAction`. */
  action: "buy" | "sell" | "income" | "reinvest";
  optAction: "BUYTOOPEN" | "BUYTOCLOSE" | "SELLTOCLOSE" | "SELLTOOPEN" | null;
  secId: string | null;
  date: string; // YYYY-MM-DD (trade date)
  units: number | null; // OFX sign: + buy, − sell
  unitPrice: number | null;
  total: number | null; // OFX sign: − debit (buy), + credit (sell)
  fees: number | null; // commission + fees, combined
  memo: string | null;
  incomeType: string | null; // DIV | INTEREST | CGLONG | … (income/reinvest only)
  isOption: boolean;
};

export type OfxDocument = {
  dialect: "ofx1" | "ofx2";
  securities: Map<string, OfxSecurity>;
  transactions: OfxTxn[];
  dtStart: string | null; // INVTRANLIST range
  dtEnd: string | null;
  brokerId: string | null;
  accountId: string | null; // broker's account number (not our internal id)
};

// ── tokenizer ────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&apos;": "'",
  "&quot;": '"',
  "&nbsp;": " ",
};

function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|apos|quot|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** Parse OFX/QFX text (either dialect) into a loose tag tree rooted at <OFX>. */
export function parseOfxTree(text: string): OfxNode {
  // Drop the header (SGML `KEY:VALUE` lines or the XML/OFX processing
  // instructions) — parsing starts at the first <OFX>.
  const start = text.search(/<OFX>/i);
  const body = start >= 0 ? text.slice(start) : text;

  const root: { [tag: string]: OfxNode | OfxNode[] } = {};
  const stack: { name: string; obj: { [tag: string]: OfxNode | OfxNode[] } }[] = [
    { name: "__root__", obj: root },
  ];

  const addChild = (parent: { [tag: string]: OfxNode | OfxNode[] }, name: string, value: OfxNode) => {
    const existing = parent[name];
    if (existing === undefined) parent[name] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else parent[name] = [existing, value];
  };

  // Each match: a tag plus the text run immediately after it (up to the next <).
  const re = /<(\/?)([A-Za-z0-9._]+)>([^<]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const isClose = m[1] === "/";
    const name = m[2].toUpperCase();
    const value = decode(m[3].trim());

    if (isClose) {
      // Close the current aggregate only if the stack top matches this tag;
      // an XML leaf's redundant close (top is the parent) is ignored.
      if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
      continue;
    }

    const top = stack[stack.length - 1].obj;
    if (value !== "") {
      // Leaf with text — self-contained, don't descend.
      addChild(top, name, value);
    } else {
      // No inline text ⇒ treat as an aggregate; descend into it.
      const obj: { [tag: string]: OfxNode | OfxNode[] } = {};
      addChild(top, name, obj);
      stack.push({ name, obj });
    }
  }

  return (root["OFX"] as OfxNode) ?? root;
}

// ── tree helpers ───────────────────────────────────────────────────────────────

function asObj(n: OfxNode | OfxNode[] | undefined): { [k: string]: OfxNode | OfxNode[] } | null {
  if (!n || typeof n === "string") return null;
  if (Array.isArray(n)) return asObj(n[0]);
  return n;
}
function leaf(node: OfxNode | OfxNode[] | undefined, tag: string): string | null {
  const o = asObj(node);
  if (!o) return null;
  const v = o[tag];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}
function child(node: OfxNode | OfxNode[] | undefined, tag: string): OfxNode | OfxNode[] | undefined {
  return asObj(node)?.[tag];
}
function toNum(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
/** OFX dates are YYYYMMDD[hhmmss[.sss]][gmt] — take the leading date. */
function ofxDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Depth-first walk yielding every aggregate node tagged `tag` (any depth). */
function collect(node: OfxNode | OfxNode[] | undefined, tag: string, out: OfxNode[] = []): OfxNode[] {
  if (!node || typeof node === "string") return out;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, tag, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === tag) {
      if (Array.isArray(v)) out.push(...(v as OfxNode[]));
      else out.push(v as OfxNode);
    }
    collect(v, tag, out);
  }
  return out;
}

// ── extraction ─────────────────────────────────────────────────────────────────

function parseSecurities(root: OfxNode): Map<string, OfxSecurity> {
  const out = new Map<string, OfxSecurity>();
  const specs: [string, OfxSecurity["kind"]][] = [
    ["STOCKINFO", "stock"],
    ["OPTINFO", "option"],
    ["MFINFO", "mf"],
    ["DEBTINFO", "debt"],
    ["OTHERINFO", "other"],
  ];
  for (const [tag, kind] of specs) {
    for (const info of collect(root, tag)) {
      const secinfo = child(info, "SECINFO");
      const uniqueId = leaf(child(secinfo, "SECID"), "UNIQUEID");
      if (!uniqueId) continue;
      const sec: OfxSecurity = {
        uniqueId,
        ticker: leaf(secinfo, "TICKER"),
        name: leaf(secinfo, "SECNAME"),
        kind,
      };
      if (kind === "option") {
        const t = leaf(info, "OPTTYPE");
        sec.option = {
          type: t === "CALL" || t === "PUT" ? t : null,
          strike: toNum(leaf(info, "STRIKEPRICE")),
          expiry: ofxDate(leaf(info, "DTEXPIRE")),
          sharesPerContract: toNum(leaf(info, "SHPERCTRCT")),
        };
      }
      out.set(uniqueId, sec);
    }
  }
  return out;
}

/** Pull the common INVBUY/INVSELL block shared by every buy/sell wrapper. */
function commonInv(inv: OfxNode | OfxNode[] | undefined): Omit<OfxTxn, "action" | "optAction" | "incomeType" | "isOption"> {
  const tran = child(inv, "INVTRAN");
  const commission = toNum(leaf(inv, "COMMISSION")) ?? 0;
  const fee = toNum(leaf(inv, "FEES")) ?? 0;
  return {
    fitid: leaf(tran, "FITID"),
    date: ofxDate(leaf(tran, "DTTRADE") ?? leaf(tran, "DTSETTLE")) ?? "",
    memo: leaf(tran, "MEMO") ?? leaf(tran, "NAME"),
    secId: leaf(child(inv, "SECID"), "UNIQUEID"),
    units: toNum(leaf(inv, "UNITS")),
    unitPrice: toNum(leaf(inv, "UNITPRICE")),
    total: toNum(leaf(inv, "TOTAL")),
    fees: commission + fee,
  };
}

function parseTransactions(root: OfxNode): OfxTxn[] {
  const txns: OfxTxn[] = [];
  const push = (t: OfxTxn) => {
    if (t.date) txns.push(t);
  };

  const buyWrappers = ["BUYSTOCK", "BUYMF", "BUYDEBT", "BUYOTHER"];
  const sellWrappers = ["SELLSTOCK", "SELLMF", "SELLDEBT", "SELLOTHER"];

  for (const tag of buyWrappers)
    for (const node of collect(root, tag))
      push({ ...commonInv(child(node, "INVBUY")), action: "buy", optAction: null, incomeType: null, isOption: false });

  for (const tag of sellWrappers)
    for (const node of collect(root, tag))
      push({ ...commonInv(child(node, "INVSELL")), action: "sell", optAction: null, incomeType: null, isOption: false });

  // Options carry open/close intent in OPTBUYTYPE / OPTSELLTYPE.
  for (const node of collect(root, "BUYOPT")) {
    const t = leaf(node, "OPTBUYTYPE"); // BUYTOOPEN | BUYTOCLOSE
    push({
      ...commonInv(child(node, "INVBUY")),
      action: "buy",
      optAction: t === "BUYTOOPEN" || t === "BUYTOCLOSE" ? t : "BUYTOOPEN",
      incomeType: null,
      isOption: true,
    });
  }
  for (const node of collect(root, "SELLOPT")) {
    const t = leaf(node, "OPTSELLTYPE"); // SELLTOCLOSE | SELLTOOPEN
    push({
      ...commonInv(child(node, "INVSELL")),
      action: "sell",
      optAction: t === "SELLTOCLOSE" || t === "SELLTOOPEN" ? t : "SELLTOCLOSE",
      incomeType: null,
      isOption: true,
    });
  }

  // Dividends / interest / cap-gains distributions, and reinvestments.
  for (const node of collect(root, "INCOME")) {
    const tran = child(node, "INVTRAN");
    push({
      fitid: leaf(tran, "FITID"),
      action: "income",
      optAction: null,
      secId: leaf(child(node, "SECID"), "UNIQUEID"),
      date: ofxDate(leaf(tran, "DTTRADE") ?? leaf(tran, "DTSETTLE")) ?? "",
      units: null,
      unitPrice: null,
      total: toNum(leaf(node, "TOTAL")),
      fees: 0,
      memo: leaf(tran, "MEMO") ?? leaf(tran, "NAME"),
      incomeType: leaf(node, "INCOMETYPE"),
      isOption: false,
    });
  }
  for (const node of collect(root, "REINVEST")) {
    const tran = child(node, "INVTRAN");
    push({
      fitid: leaf(tran, "FITID"),
      action: "reinvest",
      optAction: null,
      secId: leaf(child(node, "SECID"), "UNIQUEID"),
      date: ofxDate(leaf(tran, "DTTRADE") ?? leaf(tran, "DTSETTLE")) ?? "",
      units: toNum(leaf(node, "UNITS")),
      unitPrice: toNum(leaf(node, "UNITPRICE")),
      total: toNum(leaf(node, "TOTAL")),
      fees: (toNum(leaf(node, "COMMISSION")) ?? 0) + (toNum(leaf(node, "FEES")) ?? 0),
      memo: leaf(tran, "MEMO") ?? leaf(tran, "NAME"),
      incomeType: leaf(node, "INCOMETYPE"),
      isOption: false,
    });
  }

  return txns;
}

/** Parse an OFX/QFX file into securities + transactions + metadata. */
export function parseOfx(text: string): OfxDocument {
  const dialect: OfxDocument["dialect"] = /<\?OFX|<\?xml|OFXHEADER\s*=\s*"2/i.test(text.slice(0, 400))
    ? "ofx2"
    : "ofx1";
  const root = parseOfxTree(text);

  const invList = collect(root, "INVTRANLIST")[0];
  const acctFrom = collect(root, "INVACCTFROM")[0];

  return {
    dialect,
    securities: parseSecurities(root),
    transactions: parseTransactions(root),
    dtStart: ofxDate(leaf(invList, "DTSTART")),
    dtEnd: ofxDate(leaf(invList, "DTEND")),
    brokerId: leaf(acctFrom, "BROKERID"),
    accountId: leaf(acctFrom, "ACCTID"),
  };
}
