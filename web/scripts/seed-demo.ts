/**
 * Seeds a throwaway demo database with realistic FAKE data for marketing
 * screenshots — never the user's real accounts. Point DATABASE_PATH at a scratch
 * file (e.g. data/demo.db), then run this:
 *
 *   DATABASE_PATH=data/demo.db npm run db:migrate
 *   DATABASE_PATH=data/demo.db npx tsx scripts/seed-demo.ts
 *
 * The dataset + seed logic live in lib/demo-data.ts (`seedDemoData()`) so the
 * exact same data the app auto-loads on a fresh install is what these
 * screenshots show. Categories are seeded automatically. Persona: "Jordan Lee",
 * net worth ~$300k.
 */

import { seedDemoData } from "@/lib/demo-data";

const { transactions, budgets } = seedDemoData();
console.log("✓ Demo data seeded");
console.log(`  transactions: ${transactions} · budgets: ${budgets}`);
