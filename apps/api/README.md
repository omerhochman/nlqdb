# apps/api — Cloudflare Workers API plane

Phase 0 §3. Houses `POST /v1/ask` (DESIGN §4.1), auth endpoints
(`/v1/auth/{device, device/token, refresh, logout}`, DESIGN §4.3), and
key-management endpoints (DESIGN §4.5).

## Current state — through Slice 5

`GET /v1/health` returns `{status, version, timestamp, bindings}` —
binding presence is reflected as booleans. Bindings are typed but
not yet exercised by handler code; they'll be hit when `/v1/ask`
lands in Slice 6.

The Worker's `fetch` handler installs OpenTelemetry on every
request when `GRAFANA_OTLP_ENDPOINT` + `GRAFANA_OTLP_AUTHORIZATION`
are set, and flushes via `ctx.waitUntil(forceFlush())` before the
isolate ends. Setup is idempotent — see [`@nlqdb/otel`](../../packages/otel/README.md).

The Postgres adapter ([`@nlqdb/db`](../../packages/db/README.md)) is
ready to be called from a future handler. It emits a `db.query` span
and records into the `nlqdb.db.duration_ms` histogram per
[PERFORMANCE §3](../../PERFORMANCE.md#3-span--metric--label-catalog).

The LLM router ([`@nlqdb/llm`](../../packages/llm/README.md)) ships
the strict-$0 provider chain: Groq + Gemini + Cloudflare Workers AI
+ OpenRouter, with cost-ordered failover and the `llm.<op>` /
`nlqdb.llm.*` telemetry from PERFORMANCE §3. Slice 6 will wire it
into `/v1/ask`.

**Better Auth** is mounted at `/api/auth/*` ([`src/auth.ts`](./src/auth.ts))
with GitHub + Google social providers — backed by D1 (4 tables in
[`migrations/0002_better_auth.sql`](./migrations/0002_better_auth.sql)).
The auth instance is a top-level singleton wired via
`import { env } from "cloudflare:workers"` — Better Auth's canonical
shape, no per-request factory, no I/O at module load (only the D1
binding reference is captured; queries fire inside `auth.handler`).
GitHub credentials switch on `NODE_ENV`: `OAUTH_GITHUB_*` in prod,
`OAUTH_GITHUB_*_DEV` under `wrangler dev` (Better Auth picks at module
load — see RUNBOOK §5b for why two GitHub OAuth Apps). Telemetry per
PERFORMANCE §4 row 5: `nlqdb.auth.oauth.callback` span (callback
paths, with `nlqdb.auth.provider` attribute), `nlqdb.auth.verify` span
(every other `/api/auth/*` request), and the
`nlqdb.auth.events.total{type, outcome}` counter on both.

Magic link, the device-code flow (`/v1/auth/{device, device/token,
refresh, logout}`), the keys table (`pk_live_` / `sk_live_` /
`sk_mcp_*`), and the internal-JWT signer are explicitly NOT in Slice 5
— they land alongside the surfaces that need them (CLI / Stripe /
`/v1/ask`).

**Bindings:**

| Binding | Resource     | Type            | ID / name                                |
| :------ | :----------- | :-------------- | :--------------------------------------- |
| `KV`    | `nlqdb-cache`| KV namespace    | `5b086b03ead54f508271f31fc421bbaa`        |
| `DB`    | `nlqdb-app`  | D1 database     | `98767eb0-65df-4787-87bf-c3952d851b29`    |

R2 (`ASSETS` → `nlqdb-assets`) is deferred — needs a one-time click on
the Cloudflare dashboard to enable the R2 service, and isn't on
`/v1/ask`'s critical path. Lands when blob storage is exercised.

Tests use plain Vitest 3 importing the worker handler directly with
mock binding objects, and `vi.mock("../src/auth.ts", …)` to stub the
Better Auth singleton (the real instance loads `cloudflare:workers` at
module scope). Migrating to `@cloudflare/vitest-pool-workers` /
Miniflare lands when a handler exercises D1 / KV directly — Slice 6.

For local dev, run `bun run secrets:local` to generate
`apps/api/.dev.vars` from `.envrc` (gitignored; auto-overwritten on
re-run). `wrangler dev` overlays it on top of `[vars]`, flipping
`NODE_ENV` to `development` so Better Auth picks the `*_DEV` GitHub
credentials. Production deploys mirror via `bun run secrets:remote`
(`wrangler secret bulk`, atomic).

## Local dev

```bash
bun --cwd apps/api run secrets:local  # writes .dev.vars from .envrc (one-time / on rotation)
bun --cwd apps/api run dev            # wrangler dev — http://localhost:8787
bun --cwd apps/api run test           # vitest
bun --cwd apps/api run typecheck
bun --cwd apps/api run build          # wrangler deploy --dry-run
```

## Provisioning Cloudflare resources

```bash
./scripts/provision-cf-resources.sh   # idempotent: creates KV/D1, fills wrangler.toml IDs
```

## D1 migrations

Migrations live in [`migrations/`](./migrations) and are tracked by
wrangler in the `d1_migrations` table inside the D1 database itself
(idempotent — re-running is a no-op on already-applied migrations).

```bash
bun --cwd apps/api run migrate:local    # local SQLite under .wrangler/
bun --cwd apps/api run migrate:remote   # production D1 — needs CLOUDFLARE_*
```

Add a new migration with `wrangler d1 migrations create nlqdb-app <name>`
from `apps/api/`. Migrations are append-only — never edit a committed
SQL file.

## Deploy

```bash
bun --cwd apps/api run secrets:remote  # wrangler secret bulk from .envrc
bun --cwd apps/api run deploy          # uses CLOUDFLARE_API_TOKEN + _ACCOUNT_ID
```

## Coming up

- Slice 6: `/v1/ask` end-to-end — wires `@nlqdb/llm` + `@nlqdb/db` + the KV plan cache.
- Slice 7: Stripe webhook + R2 enable.
