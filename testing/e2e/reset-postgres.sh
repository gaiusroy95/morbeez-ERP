#!/usr/bin/env bash
# A fresh e2e database on a real Postgres, set up the way production is:
# migrated by a non-superuser owner (as RDS's master user is), with the API
# connecting as morbeez_app so row-level security applies to every request.
#
#   E2E_ADMIN_URL    superuser, maintenance database (drops and creates)
#   E2E_DB_URL       superuser, the e2e database (seeds, suite fixtures)
#   E2E_MIGRATE_URL  the non-superuser owner, the e2e database
#   E2E_DB_NAME      the e2e database's name (default morbeez_e2e)
#   E2E_DB_OWNER     the owner role, which must already exist (default migrator)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${E2E_DB_NAME:-morbeez_e2e}"
OWNER="${E2E_DB_OWNER:-migrator}"

psql "$E2E_ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" \
  -c "CREATE DATABASE $DB OWNER $OWNER"
# Untrusted extension: the superuser creates it (RDS allows its master user to).
psql "$E2E_DB_URL" -q -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"

DATABASE_URL="$E2E_MIGRATE_URL" pnpm --filter @morbeez/backend -s migrate:up > /dev/null
DATABASE_URL="$E2E_DB_URL" pnpm --filter @morbeez/backend -s seed > /dev/null
node testing/e2e/seed-master.js
