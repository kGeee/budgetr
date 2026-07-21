#!/usr/bin/env bash
# Regenerate db/demo-schema.ts (the in-memory demo DB schema) from the current
# migrations. Run after changing db/schema.ts + adding a migration.
#
#   bash scripts/gen-demo-schema.sh
#
# Migrates a throwaway DB, dumps its DDL (backticks -> double-quotes so it fits a
# template literal, __drizzle_migrations omitted), and rewrites db/demo-schema.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

TMP="$(mktemp -d)"
DB="$TMP/schema-src.db"
trap 'rm -rf "$TMP"' EXIT

DATABASE_PATH="$DB" npm run --silent db:migrate >/dev/null
SQL="$(sqlite3 "$DB" "SELECT sql||';' FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name!='__drizzle_migrations' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name;" | sed 's/`/"/g')"

{
  cat <<'HDR'
/**
 * Full SQLite DDL for the in-memory demo database used by the read-only web demo
 * (the DEMO_DB build served on the marketing site — see db/index.ts). Serverless
 * has no writable/persistent filesystem, so the demo DB is created in memory at
 * cold start, this schema is exec'd, then lib/demo-data.ts seeds it.
 *
 * Generated from the migrated schema (drizzle) — backtick identifiers rewritten
 * to double-quotes so the DDL can live in a template literal, and the
 * __drizzle_migrations bookkeeping table omitted. Regenerate after a schema
 * change with: scripts/gen-demo-schema.sh (dumps a freshly-migrated DB).
 */

export const DEMO_SCHEMA_SQL = `
HDR
  printf '%s\n' "$SQL"
  echo '`;'
} > db/demo-schema.ts

echo "✓ Regenerated db/demo-schema.ts"
