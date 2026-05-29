/**
 * Applies generated Drizzle migrations to the local SQLite database.
 * Run with: npm run db:migrate
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH ?? "./data/budgetr.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

migrate(drizzle(sqlite), { migrationsFolder: "./db/migrations" });
console.log("✓ Migrations applied to", dbPath);
sqlite.close();
