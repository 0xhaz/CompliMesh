-- 0001_postgres_machinery.sql
-- Postgres-specific machinery Drizzle Kit cannot generate. Run this AFTER the
-- Drizzle schema migration (migrations/drizzle/). See techstack §4.2 / architecture §3.3.
--
-- Can be run via the Vercel dashboard Query tab or a migration runner.
-- Idempotent where possible so it's safe to re-run during the build.

-- ── Fuzzy entity matching ──────────────────────────────────────────────────
-- pg_trgm: trigram similarity for restricted-party name screening
-- ("Huawei Technologies" vs "Huawei Tech Co Ltd" vs transliterated aliases).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on restricted-party names (the correct Postgres tool for
-- similarity search; not generatable by Drizzle).
CREATE INDEX IF NOT EXISTS idx_rp_name_trgm
  ON restricted_parties USING gin (name gin_trgm_ops);

-- ── audit_log append-only (Layer B — prevention) ───────────────────────────
-- Revoke mutation from the app role. The Vercel AWS integration's role name
-- comes from the provisioning step; until known, PUBLIC covers the default case.
-- Once the role is known, ALSO run:
--   REVOKE UPDATE, DELETE ON audit_log FROM <APP_ROLE>;
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- Belt-and-suspenders: a trigger that hard-blocks UPDATE/DELETE regardless of
-- role config. This is the portable guarantee (architecture §3.3, Layer B).
CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
