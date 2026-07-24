#!/usr/bin/env node
/**
 * Mint a signed budgetr license key.
 *
 *   node scripts/license/sign-license.mjs --email you@example.com [options]
 *
 * Options:
 *   --email <str>     Who it's issued to (required). Shown in the app.
 *   --days  <n>       Valid for N days from now. Omit for a perpetual license.
 *   --edition <str>   Plan label (default: "personal").
 *   --id <str>        License id (default: a random id).
 *   --key <path>      Private key PEM path (default: scripts/license/signing-key.private.pem,
 *                     or the LICENSE_SIGNING_KEY env var containing the PEM).
 *
 * Prints the license key to stdout. Token format matches lib/license/verify.ts:
 *   BGTR1.<base64url(payloadJSON)>.<base64url(ed25519-sig)>
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const email = arg("email");
if (!email) {
  console.error("Missing --email. See the header of this script for usage.");
  process.exit(1);
}

const days = arg("days") ? Number(arg("days")) : null;
if (days != null && (!Number.isFinite(days) || days <= 0)) {
  console.error("--days must be a positive number.");
  process.exit(1);
}
const edition = arg("edition") ?? "personal";
const id = arg("id") ?? `lic_${crypto.randomBytes(6).toString("hex")}`;

const keyPem =
  process.env.LICENSE_SIGNING_KEY ??
  fs.readFileSync(arg("key") ?? path.join(here, "signing-key.private.pem"), "utf8");

const nowSec = Math.floor(Date.now() / 1000);
const payload = {
  v: 1,
  id,
  sub: email,
  iat: nowSec,
  exp: days != null ? nowSec + days * 86400 : null,
  edition,
};

// Canonical JSON — fixed key order, matching lib/license/verify.ts.
const canonical = JSON.stringify({
  v: payload.v,
  id: payload.id,
  sub: payload.sub,
  iat: payload.iat,
  exp: payload.exp,
  edition: payload.edition,
});

const body = `BGTR1.${Buffer.from(canonical).toString("base64url")}`;
const sig = crypto.sign(null, Buffer.from(body, "ascii"), crypto.createPrivateKey(keyPem));
const token = `${body}.${Buffer.from(sig).toString("base64url")}`;

console.error(
  `Issued ${edition} license ${id} to ${email}` +
    (payload.exp ? `, expires ${new Date(payload.exp * 1000).toISOString().slice(0, 10)}.` : " (perpetual)."),
);
console.log(token);
