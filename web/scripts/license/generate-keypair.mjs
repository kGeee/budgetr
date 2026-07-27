#!/usr/bin/env node
/**
 * Generate a fresh Ed25519 signing keypair for budgetr licenses.
 *
 *   node scripts/license/generate-keypair.mjs
 *
 * Rewrites lib/license/public-key.ts with the new PUBLIC key (shipped in the app)
 * and saves the PRIVATE key to scripts/license/signing-key.private.pem (gitignored).
 * Back that private key up somewhere safe — it's the only thing that can mint
 * licenses, and rotating it invalidates every key already issued.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..", "..");

const privatePath = path.join(here, "signing-key.private.pem");
const publicTsPath = path.join(webRoot, "lib", "license", "public-key.ts");

if (fs.existsSync(privatePath) && !process.argv.includes("--force")) {
  console.error(
    `Refusing to overwrite an existing private key:\n  ${privatePath}\n` +
      `Re-run with --force if you really mean to rotate keys (invalidates all issued licenses).`,
  );
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

fs.writeFileSync(privatePath, privPem, { mode: 0o600 });

const tsBody = `/**
 * The Ed25519 PUBLIC key used to verify license signatures. Safe to ship — only
 * the matching PRIVATE key (held by the vendor, never in this repo) can mint keys.
 *
 * Regenerate the pair with \`node scripts/license/generate-keypair.mjs\`, which
 * rewrites this file and saves the private key to a gitignored path. Rotating the
 * key invalidates every previously issued license, so only do it deliberately.
 */
export const LICENSE_PUBLIC_KEY = \`${pubPem}\`;
`;
fs.writeFileSync(publicTsPath, tsBody);

console.log("New keypair generated.");
console.log(`  Public key  → embedded in ${path.relative(webRoot, publicTsPath)}`);
console.log(`  Private key → ${path.relative(webRoot, privatePath)} (gitignored — back this up!)`);
