import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";
import { DEMO_SCHEMA_SQL } from "./demo-schema";

/**
 * When DEMO_DB is set (the read-only web demo served on the marketing site), the
 * database is scratch state that lives for the life of the process: a file in
 * the OS temp dir, re-created and re-seeded on every cold start so the demo
 * always carries current dates. Nothing touches the deploy's own filesystem.
 *
 * It is a temp FILE rather than `:memory:` on purpose. Next evaluates a module
 * once per bundle layer — the react-server layer that renders Server
 * Components, the ssr layer, and the plain Node layer that runs
 * instrumentation.ts are three separate instantiations of this module. With
 * `:memory:` each got its OWN empty database, so seeding one did nothing for the
 * others: instrumentation seeded the Node-layer copy while pages queried an
 * unseeded react-server copy, and the demo only filled in because the app
 * layout re-seeded that layer on a full page load. A client-side navigation
 * renders the page without its layout, so any route reached by clicking rather
 * than loading could come back blank until a manual refresh. Pointing every
 * layer at one file per process gives them a single shared database, so
 * whichever layer seeds first, the rest see the data.
 */
const DEMO_DB = Boolean(process.env.DEMO_DB);

/** Scoped to the pid so a stale file from an earlier run is never picked up. */
function demoDbPath(): string {
  return path.join(os.tmpdir(), `budgetr-demo-${process.pid}.db`);
}

function openSqlite(): Database.Database {
  if (DEMO_DB) {
    const demo = new Database(demoDbPath());
    demo.pragma("journal_mode = WAL");
    demo.pragma("foreign_keys = ON");
    demo.pragma("busy_timeout = 5000");

    // First layer in wins and lays down the schema; the others attach to it.
    // BEGIN IMMEDIATE takes the write lock up front so two layers initialising
    // concurrently can't both run the DDL (the second would hit "table already
    // exists" — the schema is plain CREATE TABLE, not IF NOT EXISTS).
    demo.exec("BEGIN IMMEDIATE");
    try {
      const initialized = demo
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items'")
        .get();
      if (!initialized) demo.exec(DEMO_SCHEMA_SQL);
      demo.exec("COMMIT");
    } catch (err) {
      demo.exec("ROLLBACK");
      throw err;
    }
    return demo;
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
