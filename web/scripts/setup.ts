/**
 * One-command local bootstrap.  `npm run setup`
 *
 * Idempotent — safe to re-run. It:
 *   1. creates .env.local from env.example (if missing),
 *   2. generates an APP_ENCRYPTION_KEY (if unset),
 *   3. applies DB migrations,
 *   4. seeds the default categories.
 *
 * After this, `npm run dev` starts the app. Plaid credentials are still needed
 * to link real accounts (see env.example / README), but the app boots without them.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd(); // npm runs scripts from the package dir (web/)
const envLocal = path.join(root, ".env.local");
const example = path.join(root, "env.example");

const log = (msg: string) => console.log(`  • ${msg}`);
console.log("\nbudgetr · local setup\n");

// 1 — .env.local
if (fs.existsSync(envLocal)) {
  log(".env.local already exists — leaving it untouched");
} else if (fs.existsSync(example)) {
  fs.copyFileSync(example, envLocal);
  log("created .env.local from env.example");
} else {
  fs.writeFileSync(envLocal, "DATABASE_PATH=./data/budgetr.db\nPLAID_ENV=sandbox\nAPP_ENCRYPTION_KEY=\n");
  log("created a minimal .env.local");
}

// 2 — APP_ENCRYPTION_KEY (32-byte hex, used to encrypt Plaid tokens at rest)
let env = fs.readFileSync(envLocal, "utf8");
if (/^APP_ENCRYPTION_KEY=.+$/m.test(env)) {
  log("APP_ENCRYPTION_KEY already set");
} else {
  const key = randomBytes(32).toString("hex");
  env = /^APP_ENCRYPTION_KEY=\s*$/m.test(env)
    ? env.replace(/^APP_ENCRYPTION_KEY=\s*$/m, `APP_ENCRYPTION_KEY=${key}`)
    : `${env.trimEnd()}\nAPP_ENCRYPTION_KEY=${key}\n`;
  fs.writeFileSync(envLocal, env);
  log("generated APP_ENCRYPTION_KEY");
}

// 3 & 4 — migrate + seed (each loads .env.local itself)
log("applying database migrations…");
execSync("npm run --silent db:migrate", { cwd: root, stdio: "inherit" });
log("seeding default categories…");
execSync("npm run --silent db:seed", { cwd: root, stdio: "inherit" });

console.log("\n✓ Setup complete.  Start the app:  npm run dev\n");
