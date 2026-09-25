-- Runs once, on first container start (mounted to
-- /docker-entrypoint-initdb.d). Everything below is infrastructure that
-- every schema depends on, not business schema — the 67-table catalog
-- lives in versioned migrations (database/migrations/), not here.

-- pgcrypto: gen_random_uuid() for UUIDv7-style PK generation
-- (Production Database, Design Principles — "Primary keys").
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_stat_statements: query performance visibility from day one, cheap to
-- enable now and expensive to retrofit later.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
