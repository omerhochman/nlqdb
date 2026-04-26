# apps/api — Cloudflare Workers API plane

Phase 0 §3. Houses `POST /v1/ask` (DESIGN §4.1), auth endpoints
(`/v1/auth/{device, device/token, refresh, logout}`, DESIGN §4.3), and
key-management endpoints (DESIGN §4.5).

## Current state — through Slice 7

`GET /v1/health` returns `{status, version, timestamp, bindings}` —
binding presence is reflected as booleans for `KV`, `DB`,
`EVENTS_QUEUE`, and `ASSETS`.

`POST /v1/ask` (Slice 6) is mounted under `requireSession` middleware
and orchestrates the full pipeline: rate-limit → DB resolve → plan
cache → LLM router → SQL allow-list → Postgres exec → optional
summary → first-query event emit. Spans + metrics per
[`PERFORMANCE.md`](../../PERFORMANCE.md) §4 row 6.

`POST /v1/stripe/webhook` (Slice 7) is unauthenticated by middleware
— Stripe authenticates via HMAC signature against
`STRIPE_WEBHOOK_SECRET`. The handler verifies the signature, inserts
into `stripe_events` with `ON CONFLICT DO NOTHING RETURNING` for
idempotency, dispatches `checkout.session.completed` /
`customer.subscription.{created,updated,deleted}` to update the
`customers` table and emit `billing.subscription_created` /
`billing.subscription_canceled` events, and archives the raw payload
to R2 at `stripe-events/YYYY/MM/DD/{event_id}.json` via
`ctx.waitUntil`. No `trial.*` events — PLAN §5.3 has no Stripe trial
period.

### Registering the webhook in the Stripe Dashboard

- **Endpoint URL:** `https://app.nlqdb.com/v1/stripe/webhook`
- **API version:** `2026-04-22.dahlia` — pinned by
  [`STRIPE_API_VERSION`](./src/stripe/client.ts) and the
  `stripe@22.1.0` SDK; both must move together. Pinning the dashboard
  endpoint to the same version is what guarantees payload shapes
  match the SDK types we read in `extractSubscriptionFields`
  (`current_period_end` lives on `SubscriptionItem`, not Subscription).
- **Events to subscribe to** — exactly these four (anything else lands
  in `stripe_events` for audit but isn't dispatched, so subscribing
  generates noise without value):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- After saving, copy the signing secret into `.envrc` as
  `STRIPE_WEBHOOK_SECRET=whsec_…`, then `bun run secrets:remote`. The
  secret is the only thing the handler reads; rotating it = re-running
  `secrets:remote` after pasting the new value.

The Worker's `fetch` handler installs OpenTelemetry on every
request when `GRAFANA_OTLP_ENDPOINT` + `GRAFANA_OTLP_AUTHORIZATION`
are set, and flushes via `ctx.waitUntil(forceFlush())` before the
isolate ends. Setup is idempotent — see [`@nlqdb/otel`](../../packages/otel/README.md).

The Postgres adapter ([`@nlqdb/db`](../../packages/db/README.md))
is wired into `/v1/ask`'s exec step. It emits a `db.query` span and
records into the `nlqdb.db.duration_ms` histogram per
[PERFORMANCE §3](../../PERFORMANCE.md#3-span--metric--label-catalog).

The LLM router ([`@nlqdb/llm`](../../packages/llm/README.md)) is
wired into `/v1/ask`'s plan + summarize steps. Strict-$0 provider
chain: Groq + Gemini + Cloudflare Workers AI + OpenRouter, with
cost-ordered failover and the `llm.<op>` / `nlqdb.llm.*` telemetry
from PERFORMANCE §3.

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
`sk_mcp_*`), and the internal-JWT signer are not in Phase 0 — they
land alongside the surfaces that need them (CLI / Stripe / public
`<nlq-data>` embed).

**Bindings:**

| Binding         | Resource         | Type           | ID / name                                              |
| :-------------- | :--------------- | :------------- | :----------------------------------------------------- |
| `KV`            | `nlqdb-cache`    | KV namespace   | `5b086b03ead54f508271f31fc421bbaa`                     |
| `DB`            | `nlqdb-app`      | D1 database    | `98767eb0-65df-4787-87bf-c3952d851b29`                 |
| `EVENTS_QUEUE`  | `nlqdb-events`   | Queue producer | name-bound; consumer is [`apps/events-worker`](../events-worker/README.md) |
| `ASSETS`        | `nlqdb-assets`   | R2 bucket      | name-bound; Stripe-event archive + future blob surfaces |

R2 service requires a one-time dashboard opt-in (account → R2 → Get
Started). Once enabled, `scripts/provision-cf-resources.sh` creates
the bucket idempotently.

Tests run as two Vitest projects (see `vitest.config.ts`): a fast
**unit** project for pure-function modules with stubbed deps (~1s),
and an **integration** project under `@cloudflare/vitest-pool-workers`
for handlers that exercise real D1 / KV / `SELF.fetch` (~25s of
Miniflare boot). Iterate with `bun x vitest run --project unit`;
`bun run test` runs both at PR-finalization time.

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
./scripts/provision-cf-resources.sh   # idempotent: creates KV / D1 / Queue / R2 bucket, fills wrangler.toml IDs
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

All three steps are required — skipping `migrate:remote` 500s the
auth + DB routes silently against an unmigrated D1 (PR #30 incident).

```bash
bun --cwd apps/api run secrets:remote  # wrangler secret bulk from .envrc
bun --cwd apps/api run migrate:remote  # apply unapplied D1 migrations
bun --cwd apps/api run deploy          # uses CLOUDFLARE_API_TOKEN + _ACCOUNT_ID
```

## Coming up

- **Phase 1 (`apps/web`, Astro):** opens this auth surface to end users —
  sign-in page (`/sign-in?return_to=…` per DESIGN §4.3), post-callback
  landing, anonymous-mode → adoption flow (DESIGN §14). Until then,
  `/api/auth/*` is API-only; `app.nlqdb.com/` 404s by design.
