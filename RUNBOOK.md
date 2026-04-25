# nlqdb Runbook

Living state-of-the-world doc. Ground truth for *what's provisioned*,
*where it lives*, and *how to get back in*. Edit this whenever
infrastructure changes — if it goes stale, the rest of the repo gets
harder to operate.

- [DESIGN.md](./DESIGN.md) — why the architecture looks this way.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — phased plan + prereqs.
- [PERFORMANCE.md](./PERFORMANCE.md) — SLOs, latency budgets, span/metric catalog.
- **this file** — what's actually set up right now.

**Last verified: 2026-04-25.** Running `./scripts/verify-secrets.sh`
should return 21/21 green (or more, as provisioning expands).

---

## 1. What is live

| Surface                     | URL                                 | State                          |
| :-------------------------- | :---------------------------------- | :----------------------------- |
| Coming-soon landing         | https://nlqdb.com                   | 200, HTTPS via Cloudflare      |
| Privacy policy              | https://nlqdb.com/privacy           | 200                            |
| Terms of service            | https://nlqdb.com/terms             | 200                            |
| `www.nlqdb.com`             | https://www.nlqdb.com               | 200 (same page)                |
| Alt apex                    | https://nlqdb.ai                    | 301 → `https://nlqdb.com/`     |
| Alt www                     | https://www.nlqdb.ai                | 301 → `https://nlqdb.com/…`    |
| Pages deployment URL        | https://nlqdb-coming-soon.pages.dev | 200 (same content as nlqdb.com)|

No runtime services yet — Phase 0 `apps/api` hasn't shipped.

---

## 2. Domains

Both zones are on Cloudflare's **Free plan**, nameservers
`jeremy.ns.cloudflare.com` + `kiki.ns.cloudflare.com`, registered at
GoDaddy. DNSSEC is off at both ends (safe for now; optional to
re-enable via Cloudflare later).

### `nlqdb.com`

- DNS managed by Cloudflare.
- Custom domain attached to the Pages project `nlqdb-coming-soon`
  (Cloudflare auto-created the DNS records on attach).
- `www` also attached to the same Pages project.
- **Cloudflare Email Routing ON:**
  - `hello@nlqdb.com` → founder's personal inbox (verified).
  - Catch-all: check current state at
    https://dash.cloudflare.com → zone → Email.

### `nlqdb.ai`

- DNS managed by Cloudflare.
- `AAAA @ → 100::` proxied (dummy target; Cloudflare Single Redirect
  rule intercepts before the target matters).
- `CNAME www → nlqdb.ai` proxied.
- **Single Redirect rule:** `All incoming requests` → dynamic
  expression `concat("https://nlqdb.com", http.request.uri)`, status
  301. Preserves path + query string.
- Email Routing: **not yet enabled.** When enabled, forward to the
  same destination as `nlqdb.com`.

---

## 3. Accounts

| Service          | Account                   | Plan                              | Non-secret identifier                              |
| :--------------- | :------------------------ | :-------------------------------- | :------------------------------------------------- |
| GitHub           | `omerhochman` (personal)  | Org `nlqdb` (free)                | Repo: `nlqdb/nlqdb`; tap: `nlqdb/homebrew-tap`     |
| npm              | `omerhochman`             | Free (unlimited public packages)  | Scope `@nlqdb`                                     |
| Cloudflare       | `omer.hochman@gmail.com`  | Free per zone                     | Token name: `nlqdb-phase0-dev`                     |
| Neon             | `omer.hochman@gmail.com`  | Free                              | Project in `us-east-1`, PG 17, **Neon Auth OFF**   |
| Upstash          | `omer.hochman@gmail.com`  | Free                              | Redis DB provisioned                               |
| Fly.io           | `omer.hochman@gmail.com`  | 7-day trial → PAYG (no card yet)  | Org `personal`, **no apps**, token scope: `org`    |
| Sentry           | `omer.hochman@gmail.com`  | 14-day Business trial → Developer | Project: `nlqdb-api` (Cloudflare Workers platform) |
| Google AI Studio | Existing                  | Free                              | Gemini API key                                     |
| Groq             | Existing                  | Free                              | —                                                  |
| OpenRouter       | Existing                  | Free (fallback)                   | —                                                  |
| Google Cloud     | `omer.hochman@gmail.com`  | Free                              | Project `nlqdb`, OAuth consent screen **Testing**  |
| Resend           | `omer.hochman@gmail.com`  | Free (3k emails/mo)               | API key `nlqdb-phase0`; domain verification ⏳ Phase 1 |
| Stripe           | `omer.hochman@gmail.com`  | Test mode (no card)               | Merchant: Switzerland / CHF; descriptor `NLQDB.COM`; webhook secret ⏳ Phase 0 §3 |
| Grafana Cloud    | `omer.hochman@gmail.com`  | Free                              | Stack `nlqdb` on `us-east-2`, instance `1609127`, access policy `nlqdb-phase0-telemetry` |
| Docker Hub       | **SKIPPED**               | —                                 | Using `ghcr.io/nlqdb` instead (paid-only org tier) |

**Not yet provisioned**:

- Stripe webhook secret — needs `apps/api` (Phase 0 §3) to host the endpoint.
- LogSnag (`LOGSNAG_TOKEN` + `LOGSNAG_PROJECT`) — Phase 1. Free tier
  (2,500 events/mo, 3 seats). Sole sink for `packages/events`; LogSnag
  fans events out to Slack / Discord / email itself.

**Explicitly deferred** (re-evaluate if a real cohort question lands):

- PostHog Cloud (`POSTHOG_API_KEY`, `POSTHOG_HOST`) — optional Phase 2
  second sink for funnels / retention. Pre-PMF, SQL on D1/Neon
  answers every analytics question we actually have. Designed to
  plug into `packages/events` with zero call-site changes when
  needed.

**Explicitly skipped** (re-evaluate post-PMF):

- AWS SES — card-required; Resend free tier (3k/mo) is enough pre-PMF.
  When/if a fallback is needed, prefer Postmark / MailerSend / Loops.

---

## 4. Secrets

Every credential's canonical name lives in
[`.env.example`](./.env.example). Never commit real values.

- **Local dev:** `.envrc` (gitignored), loaded automatically by
  direnv. Regenerate self-signed secrets by running
  `scripts/bootstrap-dev.sh` after deleting `.envrc`.
- **CI (GitHub Actions):** mirrored from `.envrc` via
  `scripts/mirror-secrets-gha.sh` (idempotent; never logs values).
  Skips `BETTER_AUTH_SECRET` + `INTERNAL_JWT_SECRET` — local-dev only;
  CI workflows generate ephemeral test values per run.
- **Runtime (Cloudflare Workers):** not yet mirrored — Phase 0 §3
  pending (needs `apps/api` to exist).

**Live verification:** `./scripts/verify-secrets.sh`. Current baseline
is 21 ✅ across self-generated, Cloudflare ×3, Neon ×2, Fly, Upstash,
LLM ×3, OAuth ×4 (Google ×2 + GitHub prod pair + GitHub dev pair),
Resend, Stripe ×2 (sk + pk), Grafana, Sentry. Stripe webhook secret
skips cleanly until `apps/api` exists (Phase 0 §3).

**Values never echoed** — all checks are length/HTTP-status based.

---

## 5. Google OAuth — what's configured

Google has a long verification review, so we opened the project early.
Currently in **Testing** mode; verification submission is a Phase 1
prereq (waiting on product stability).

- **GCP project:** `nlqdb`
- **OAuth consent screen** (Branding tab):
  - App name: `nlqdb`
  - User support email: `contact@nlqdb.com` (needs Email Routing rule
    — currently only `hello@` is forwarded; add `contact@` or flip
    catch-all on if Google's verification emails get lost)
  - Privacy policy: https://nlqdb.com/privacy
  - Terms of service: https://nlqdb.com/terms
  - Authorized domain: `nlqdb.com`
- **Audience:** External, Testing status.
  - Test users: `omer.hochman@gmail.com` (add more as needed, up to 100)
- **Data access (scopes):** `openid`, `/auth/userinfo.email`,
  `/auth/userinfo.profile` — all non-sensitive, no long review needed
  when we submit for verification.
- **OAuth 2.0 Client** — Web application named `nlqdb-web`:
  - Authorized JavaScript origins:
    - `https://app.nlqdb.com`
    - `https://nlqdb.com`
    - `http://localhost:8787` (Wrangler dev — Better Auth lives in
      Workers, see §5b)
  - Authorized redirect URIs:
    - `https://app.nlqdb.com/api/auth/callback/google` (prod)
    - `http://localhost:8787/api/auth/callback/google` (Wrangler dev)
  - Credentials in `.envrc` as `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.

  **Path scheme:** `/api/auth/*` is Better Auth's default basePath; we
  keep it. Custom device-flow endpoints land at `/v1/auth/{device,
  device/token, refresh, logout}` in a later slice (different paths,
  different ownership) — Google's redirect URI list above is OAuth-only.

**Verification submission TODO** (Phase 1):

1. Publish Privacy Policy + Terms (done — PR #12 merged).
2. Verify domain ownership of `nlqdb.com` via Google Search Console
   (DNS TXT record in Cloudflare — 2 min).
3. Add an app logo (min 120×120 PNG).
4. Switch publishing status from Testing → In Production.
5. Google reviews; with only non-sensitive scopes it's usually days,
   not weeks.

---

## 5b. GitHub OAuth — what's configured

Classic **OAuth App** under the `nlqdb` GitHub org (not a GitHub App —
we need sign-in only, no installation/permission semantics). nlqdb is
**engine-agnostic** — describe its sign-in to the user as "Sign in to
nlqdb." rather than naming a specific backend.

- **Org settings page:** `https://github.com/organizations/nlqdb/settings/applications`
- **App name:** `nlqdb-web` (production sign-in).
- **Homepage URL:** `https://nlqdb.com`
- **Authorization callback URL** — exactly **one** URL per OAuth App.
  GitHub OAuth Apps **do not support** multiple callback URLs (that
  capability is for GitHub Apps, a different product). Multi-env
  strategy:
  - **`nlqdb-web` (prod):** homepage `https://nlqdb.com`, callback
    `https://app.nlqdb.com/api/auth/callback/github`. Credentials in
    `.envrc` as `OAUTH_GITHUB_CLIENT_ID` + `_SECRET`.
  - **`nlqdb-web-dev`:** homepage `http://localhost:8787` (Wrangler
    dev — Better Auth lives in Workers per DESIGN §4), callback
    `http://localhost:8787/api/auth/callback/github`. Credentials in
    `.envrc` as `OAUTH_GITHUB_CLIENT_ID_DEV` + `_SECRET_DEV`. Better
    Auth picks based on `NODE_ENV` (set via `wrangler.toml [vars]`).
  - `/api/auth/*` is Better Auth's default basePath; we keep it.
    `/v1/auth/{device, device/token, refresh, logout}` are different
    custom endpoints landing in a later slice — they don't use this
    callback URL.
  - `https://nlqdb.com/device/approve` is the **device-flow user-prompt
    page**, not an OAuth redirect — device flow polls and never invokes
    the callback URL, so it doesn't need to be registered.
- **Enable Device Flow:** ✅ — CLI uses device-code flow (`nlq login`)
  per [DESIGN.md §3.3](./DESIGN.md#33-cli-and-device-code-flow).
- **Webhook URL:** _none_ — auth-only, no webhook.
- **Credentials in `.envrc`** as `OAUTH_GITHUB_CLIENT_ID` +
  `OAUTH_GITHUB_CLIENT_SECRET` (the `OAUTH_*` prefix avoids GHA's
  reserved `GITHUB_*` namespace; same names used in CI / Workers
  secrets so mirroring is 1:1). Refresh `.envrc.age` via
  `scripts/backup-envrc.sh` after pasting.

**Verification:** `./scripts/verify-secrets.sh` does a live probe of
`POST /applications/{client_id}/token` with the secret pair as Basic
auth and a deliberately-bogus token in the body. Expected HTTP **404**
= Basic auth accepted, the bogus token correctly not-found. **401** is
the failure path (Basic auth rejected = wrong id or secret).

---

## 6. Deployments

### Coming-soon page

- Source: `apps/coming-soon/` (HTML + CSS, no build step).
- Hosting: Cloudflare Pages project `nlqdb-coming-soon`.
- Deploy: `./scripts/deploy-coming-soon.sh` (idempotent — creates the
  project on first run, pushes a new deployment on re-runs).
  Shortcut: `bun --cwd apps/coming-soon run deploy`.
- Custom domains: `nlqdb.com`, `www.nlqdb.com`.

### `apps/api` (Phase 0 §3 — in progress)

Cloudflare Worker `nlqdb-api`. Slice 1 shipped `/v1/health`; Slice 2
added KV + D1 bindings (R2 deferred); Slice 3 added the Neon adapter
(`packages/db`), the OTel SDK + OTLP exporters (`packages/otel`), and
the first D1 migration; Slice 4 landed the strict-$0 LLM router
(`packages/llm`) — Groq + Gemini + Workers AI + OpenRouter behind a
cost-ordered failover chain; Slice 5 wires Better Auth at
`/api/auth/*` with GitHub + Google social providers, backed by D1
(four tables in `migrations/0002_better_auth.sql`). Deploys via
`wrangler deploy` from `apps/api/`. Resource IDs are committed in
`apps/api/wrangler.toml` (account-scoped, not secret).

**Cloudflare resources** (provisioned by
`scripts/provision-cf-resources.sh`, idempotent):

| Resource | Name           | Binding   | ID/Reference                            |
| :------- | :------------- | :-------- | :-------------------------------------- |
| KV       | `nlqdb-cache`  | `KV`      | `5b086b03ead54f508271f31fc421bbaa`       |
| D1       | `nlqdb-app`    | `DB`      | `98767eb0-65df-4787-87bf-c3952d851b29`   |
| R2       | _deferred_     | `ASSETS`  | needs one-time dashboard opt-in; not on `/v1/ask` critical path |

Re-running the provision script is safe — existing resources are
detected by name and skipped.

**D1 migrations** live in `apps/api/migrations/` and are tracked by
wrangler in the `d1_migrations` table inside the D1 DB itself.
Idempotent wrappers:

```bash
scripts/migrate-d1.sh local    # ~/.wrangler local SQLite (no auth)
scripts/migrate-d1.sh remote   # production D1 (needs CLOUDFLARE_*)
```

The first migration (`0001_init.sql`) creates the `databases` table —
the tenant → Neon connection registry that `/v1/ask` will read in
Slice 6.

**Telemetry**: `apps/api`'s Worker installs the OTel SDK on every
request (idempotent) when `GRAFANA_OTLP_ENDPOINT` and
`GRAFANA_OTLP_AUTHORIZATION` are set as Worker secrets, and flushes
spans + metrics via `ctx.waitUntil(forceFlush())`. Without those
secrets the Worker is a no-op telemetry-wise — fine for local dev.

**LLM provider chain**: `packages/llm` reads four secrets at
request time — `GROQ_API_KEY`, `GEMINI_API_KEY`, `CF_AI_TOKEN`
(+ `CLOUDFLARE_ACCOUNT_ID`), `OPENROUTER_API_KEY`. Per-operation
chains are baked in as defaults (DESIGN §8.1) and will become
env-overridable when the router is wired into `/v1/ask` in Slice 6.
A provider listed in a chain but missing its key is simply skipped
and increments `nlqdb.llm.failover.total{reason="not_configured"}`
— the next provider in the chain handles the call.

**Better Auth** (`apps/api/src/auth.ts`): top-level singleton, wired
via `import { env } from "cloudflare:workers"`. Reads
`BETTER_AUTH_SECRET`, `OAUTH_GITHUB_CLIENT_{ID,SECRET}` (or `_DEV`
when `NODE_ENV !== "production"`), `GOOGLE_CLIENT_{ID,SECRET}` at
module load. Persists to D1 via `kysely-d1`. `basePath: "/api/auth"`
(Better Auth's default; matches the OAuth Apps registered in §5b
and the Google client redirect URIs in §5).

Secrets mirror — single source of truth is `.envrc`:

```bash
bun --cwd apps/api run secrets:local    # writes apps/api/.dev.vars (wrangler dev)
bun --cwd apps/api run secrets:remote   # wrangler secret bulk → deployed Worker
```

Both modes filter to the Worker-runtime subset (BETTER_AUTH_SECRET,
OAUTH_GITHUB_*, GOOGLE_CLIENT_*, LLM keys, DATABASE_URL, GRAFANA_*).
`GRAFANA_OTLP_AUTHORIZATION` is computed from the
`GRAFANA_CLOUD_INSTANCE_ID:GRAFANA_CLOUD_API_KEY` pair so rotation
stays on the pair (IMPLEMENTATION §2.6). Re-run after any `.envrc`
rotation; idempotent.

---

## 7. Prerequisites checklist (§2 of IMPLEMENTATION.md)

| §    | Item                               | Status       |
| :--- | :--------------------------------- | :----------- |
| 2.1  | `nlqdb.com` zone + Pages + SSL     | ✅            |
| 2.1  | `nlqdb.com` Email Routing          | ✅            |
| 2.1  | `nlqdb.ai` zone + 301 redirect     | ✅            |
| 2.1  | `nlqdb.ai` Email Routing           | ⏳ (optional) |
| 2.2  | GitHub org `nlqdb`                 | ✅            |
| 2.2  | Repo transfer to `nlqdb/nlqdb`     | ✅            |
| 2.2  | Secret scanning + Dependabot       | ✅            |
| 2.2  | `nlqdb/homebrew-tap` repo          | ✅ (empty)    |
| 2.2  | npm org `@nlqdb`                   | ✅            |
| 2.2  | Docker Hub org                     | ⏭ skipped → `ghcr.io/nlqdb` |
| 2.3  | `CLOUDFLARE_API_TOKEN` + account ID | ✅            |
| 2.3  | Neon DB + `DATABASE_URL`           | ✅            |
| 2.3  | `NEON_API_KEY` (control plane)     | ✅            |
| 2.3  | Upstash Redis + token              | ✅            |
| 2.3  | `FLY_API_TOKEN` (org scope)        | ✅            |
| 2.4  | Gemini / Groq / OpenRouter keys    | ✅            |
| 2.5  | `BETTER_AUTH_SECRET` (self-gen)    | ✅            |
| 2.5  | `INTERNAL_JWT_SECRET` (self-gen)   | ✅            |
| 2.5  | GitHub OAuth app — `nlqdb-web` (prod)  | ✅            |
| 2.5  | GitHub OAuth app — `nlqdb-web-dev`     | ✅            |
| 2.5  | Google OAuth client                | ✅ (Testing)  |
| 2.5  | Resend API key                     | ✅ (domain verification ⏳ Phase 1) |
| 2.5  | ~~AWS SES fallback~~               | ⏭ dropped — card-required; Resend free tier suffices pre-PMF |
| 2.5  | Stripe (test mode) — sk + pk       | ✅            |
| 2.5  | Stripe webhook secret              | ⏳ (Phase 0 §3 with `apps/api`) |
| 2.6  | Sentry DSN                         | ✅            |
| 2.6  | Grafana Cloud OTLP                 | ✅            |
| 2.6  | LogSnag (`LOGSNAG_TOKEN` + `LOGSNAG_PROJECT`) | ⏳ (Phase 1 — single product-event sink) |
| 2.6  | PostHog Cloud (`POSTHOG_API_KEY`, `POSTHOG_HOST`) | ⏭ optional Phase 2 (only if SQL on D1/Neon stops being enough) |
| 2.7  | Mirror `.envrc` → GHA secrets      | ✅ via `scripts/mirror-secrets-gha.sh` |
| 2.7  | Mirror `.envrc` → Workers secrets  | ✅ via `scripts/mirror-secrets-workers.sh local`/`remote` |
| 3    | `apps/api` Worker skeleton + `/v1/health` | ✅ (Slice 1 — PR #21) |
| 3    | KV namespace `nlqdb-cache` (binding `KV`) | ✅ (Slice 2) |
| 3    | D1 database `nlqdb-app` (binding `DB`)    | ✅ (Slice 2) |
| 3    | Neon adapter + OTel SDK + first D1 migration | ✅ (Slice 3 — PR #24) |
| 3    | LLM router with strict-$0 provider chain  | ✅ (Slice 4 — PR #25) |
| 3    | Better Auth at `/api/auth/*` + D1 0002    | ✅ (Slice 5)          |
| 3    | R2 bucket `nlqdb-assets` (binding `ASSETS`) | ⏳ deferred — needs dashboard opt-in |

---

## 8. Recovery playbook

### Returning after time away

```bash
git pull                        # pick up any merged PRs
direnv allow .                  # re-source .envrc if needed
./scripts/verify-secrets.sh     # should be all-green
gh pr list                      # what's open
```

### New machine (or recovering from lost `.envrc`)

```bash
git clone git@github.com:nlqdb/nlqdb.git && cd nlqdb
scripts/bootstrap-dev.sh        # tools + stub .envrc from .env.example
scripts/restore-envrc.sh        # decrypts iCloud backup over the stub
./scripts/verify-secrets.sh     # should be all-green
```

**Encrypted `.envrc` backup lives outside the repo.** `.envrc.age` is
gitignored — the repo history was rewritten on 2026-04-25 to remove a
previously-committed copy; do not re-introduce one. Default location:
`~/Library/Mobile Documents/com~apple~CloudDocs/nlqdb-backups/.envrc.age`
(iCloud Drive). Produced by `scripts/backup-envrc.sh` using age
passphrase mode (scrypt KDF, cost 2^18). Refresh after any `.envrc`
change:

```bash
scripts/backup-envrc.sh         # encrypts .envrc → $NLQDB_BACKUP_DIR/.envrc.age
```

Override the sync location:

```bash
NLQDB_BACKUP_DIR=/path/to/private/folder scripts/backup-envrc.sh
```

### When a credential fails verify

| Credential             | Rotation path                                                              |
| :--------------------- | :------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com/profile/api-tokens → regenerate (same perms)   |
| `CLOUDFLARE_ACCOUNT_ID`| `wrangler whoami` — never rotates                                          |
| `NEON_API_KEY`         | Neon → Account settings → API keys → create new                            |
| `DATABASE_URL`         | Neon → Branches → main → Roles → `neondb_owner` → Reset password           |
| `FLY_API_TOKEN`        | `fly tokens create org --name nlqdb-phase0-<purpose>`                      |
| `UPSTASH_REDIS_REST_*` | console.upstash.com → DB → REST API section                                |
| `GEMINI_API_KEY`       | https://aistudio.google.com/apikey                                         |
| `GROQ_API_KEY`         | https://console.groq.com/keys                                              |
| `OPENROUTER_API_KEY`   | https://openrouter.ai/settings/keys                                        |
| `SENTRY_DSN`           | Sentry → project settings → Client Keys (DSN). Project-scoped, safe-ish to re-share. |
| `LOGSNAG_TOKEN`        | app.logsnag.com → Settings → API Tokens → revoke + create. 32-char hex. `LOGSNAG_PROJECT` is a slug, doesn't rotate. |
| `POSTHOG_API_KEY`      | app.posthog.com → Project settings → Project API Key. Public-ish (used client-side too); rotate via "Reset" in the same panel. |
| `GOOGLE_CLIENT_*`      | GCP → APIs & Services → Credentials → reset secret (client ID stays)       |
| `BETTER_AUTH_SECRET`   | `bun -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))'` — rotating this invalidates every active session. |
| `INTERNAL_JWT_SECRET`  | Same generator as above. Workers-only; rotating is safe any time (30 s TTL). |

### When a domain goes wrong

1. Check NS: `dig +short NS nlqdb.com @1.1.1.1` — must return `jeremy.ns.cloudflare.com` + `kiki.ns.cloudflare.com`. If different, GoDaddy reverted — log in → Nameservers → re-apply.
2. Check zone status: dash.cloudflare.com → the zone → Overview → should be Active.
3. Check Pages custom domain: dash.cloudflare.com → Workers & Pages → `nlqdb-coming-soon` → Custom domains → should show `nlqdb.com` with a green "Active" pill.
4. If `nlqdb.com` returns "This domain is not configured": the Pages custom-domain attachment got removed — re-add via the UI (see IMPLEMENTATION §2.1, step 4).

### When the coming-soon page looks wrong

```bash
./scripts/deploy-coming-soon.sh
```

Idempotent. Pushes a fresh deployment within ~2s.
