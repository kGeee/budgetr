import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { DEMO_SCHEMA_SQL } from "./demo-schema";

/**
 * When DEMO_DB is set (the read-only web demo served on the marketing site), the
 * database lives entirely IN MEMORY. Serverless (Vercel) has no persistent or
 * writable filesystem, so we create a fresh `:memory:` DB per cold start, apply
 * the bundled schema, and let lib/demo-data.ts seed it on first request. Nothing
 * touches disk, and the demo re-seeds with current dates on every cold start.
 */
const DEMO_DB = Boolean(process.env.DEMO_DB);

function openSqlite(): Database.Database {
  if (DEMO_DB) {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");
    mem.exec(DEMO_SCHEMA_SQL);
    return mem;
  }

  const dbPath = process.env.DATABASE_PATH ?? "./data/budgetr.db";
  // Ensure the parent directory exists before opening the file.
  // The turbopackIgnore comment scopes this filesystem operation out of
  // Turbopack's NFT import tracing, which would otherwise warn that the whole
  // project was traced because of the runtime path.resolve/fs.mkdirSync call.
  fs.mkdirSync(path.dirname(path.resolve(/* turbopackIgnore: true */ dbPath)), {
    recursive: true,
  });
  const file = new Database(dbPath);
  file.pragma("journal_mode = WAL");
  file.pragma("foreign_keys = ON");
  // Next runs multiple render workers, each with its own connection; make a writer
  // that finds the DB briefly locked wait rather than throw SQLITE_BUSY.
  file.pragma("busy_timeout = 5000");
  return file;
}

const sqlite = openSqlite();

export const db = drizzle(sqlite, { schema });
export { schema };
