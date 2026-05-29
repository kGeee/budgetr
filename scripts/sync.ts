/**
 * CLI sync — pull fresh data from all linked institutions.
 * Run with: npm run sync   (great for a cron job / nightly net-worth snapshot)
 */
import { syncAllItems } from "@/lib/sync";

syncAllItems()
  .then((r) => {
    console.log("✓ Sync complete:", JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error("✗ Sync failed:", e);
    process.exit(1);
  });
