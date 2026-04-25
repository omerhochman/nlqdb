# apps/api — Cloudflare Workers API plane

Phase 0 §3. Houses `POST /v1/ask` (DESIGN §4.1), auth endpoints
(`/v1/auth/{device, device/token, refresh, logout}`, DESIGN §4.3), and
key-management endpoints (DESIGN §4.5).

## Current state — through Slice 3

`GET /v1/health` returns `{status, version, timestamp, bindings}` —
binding presence is reflected as booleans. Bindings are typed but
not yet exercised by handler code; they'll be hit when `/v1/ask`
lands in Slice 6.

The Worker's `fetch` handler now installs OpenTelemetry on every
request when `GRAFANA_OTLP_ENDPOINT` + `GRAFANA_OTLP_AUTHORIZATION`
are set, and flushes via `ctx.waitUntil(forceFlush())` before the
isolate ends. Setup is idempotent — see [`@nlqdb/otel`](../../packages/otel/README.md).

The Postgres adapter ([`@nlqdb/db`](../../packages/db/README.md)) is
ready to be called from a future handler. It emits a `db.query` span
and records into the `nlqdb.db.duration_ms` histogram per
[PERFORMANCE §3](../../PERFORMANCE.md#3-span--metric--label-catalog).

**Bindings:**

| Binding | Resource     | Type            | ID / name                                |
| :------ | :----------- | :-------------- | :--------------------------------------- |
| `KV`    | `nlqdb-cache`| KV namespace    | `5b086b03ead54f508271f31fc421bbaa`        |
| `DB`    | `nlqdb-app`  | D1 database     | `98767eb0-65df-4787-87bf-c3952d851b29`    |

R2 (`ASSETS` → `nlqdb-assets`) is deferred — needs a one-time click on
the Cloudflare dashboard to enable the R2 service, and isn't on
`/v1/ask`'s critical path. Lands when blob storage is exercised.

Tests use plain Vitest 3 importing the worker handler directly with
mock binding objects. Slice 4+ swaps to `@cloudflare/vitest-pool-workers`
/ Miniflare for real binding behaviour.

## Local dev

```bash
bun --cwd apps/api run dev        # wrangler dev — http://localhost:8787
bun --cwd apps/api run test       # vitest
bun --cwd apps/api run typecheck
bun --cwd apps/api run build      # wrangler deploy --dry-run
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
bun --cwd apps/api run deploy     # uses CLOUDFLARE_API_TOKEN + _ACCOUNT_ID
```

## Coming up

- Slice 4: LLM router (`packages/llm`) — provider chain, plan-cache hits read KV.
- Slice 5: Better Auth scaffold + `/auth/callback/github` (uses both `OAUTH_GITHUB_*` prod and `_DEV` pairs).
- Slice 6: `/v1/ask` end-to-end.
- Slice 7: Workers-secret mirror + Stripe webhook + R2 enable.
