import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH ?? "./data/budgetr.db";

// Ensure the parent directory exists before opening the file.
// The turbopackIgnore comment scopes this filesystem operation out of
// Turbopack's NFT import tracing, which would otherwise warn that the whole
// project was traced because of the runtime path.resolve/fs.mkdirSync call.
fs.mkdirSync(path.dirname(path.resolve(/* turbopackIgnore: true */ dbPath)), {
  recursive: true,
});

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };
