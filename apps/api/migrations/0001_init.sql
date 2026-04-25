-- Slice 3 — first D1 migration.
--
-- D1 holds nlqdb app state (DESIGN §2). User identity / sessions land
-- in Slice 5 (Better Auth, separate migration). This migration ships
-- the `databases` registry — the tenant → Neon connection lookup that
-- `/v1/ask` consults to know which DB to query (Slice 6).
--
-- Why store a secret *ref* and not the URL: per DESIGN §4.4 the edge is
-- the only component that sees external credentials. The URL itself
-- lives in Cloudflare Secret Store, keyed by `connection_secret_ref`.
-- D1 just holds the binding name.

CREATE TABLE databases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT 'postgres',
  connection_secret_ref TEXT NOT NULL,
  schema_hash TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_databases_tenant ON databases (tenant_id);
