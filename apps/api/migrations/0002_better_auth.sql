-- Slice 5 — Better Auth (DESIGN §4.1, IMPLEMENTATION §3, PERFORMANCE §4 row 5).
--
-- Better Auth stores its identity / session state in D1. The four tables
-- below match Better Auth's default Kysely-on-SQLite schema. Names use
-- camelCase to match Better Auth's defaults — SQLite identifiers are
-- case-insensitive when unquoted, so this is equivalent to snake_case at
-- the SQL level, and keeps `@better-auth/cli generate` usable for future
-- additive changes (magic-link, passkey, organization plugins) without
-- per-field mapping config in the auth instance.
--
-- Timestamps are TEXT (ISO-8601) — what Better Auth's Kysely adapter
-- writes by default for SQLite. (Slice 3's `databases` table uses
-- INTEGER `unixepoch()` because we own that schema; we don't here.)

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_session_user ON session (userId);
CREATE INDEX idx_session_token ON session (token);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  idToken TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_account_user ON account (userId);
CREATE UNIQUE INDEX idx_account_provider ON account (providerId, accountId);

CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_verification_identifier ON verification (identifier);
