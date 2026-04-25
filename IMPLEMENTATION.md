# nlqdb — Implementation Plan

Execution plan for [`DESIGN.md`](./DESIGN.md) and [`PLAN.md`](./PLAN.md).
Answers:

1. **What do we build, in what order, with what dependencies?** (§3–§7)
2. **What accounts and API keys must we provision first, all $0?** (§2)

For *why* a decision was made, read `DESIGN.md`. This doc does not restate
rationale.

---

## 1. Operating principles

- **Ship the on-ramp first.** The goal-first homepage → first answer path
  ships before anything else.
- **Vertical slices, not horizontal layers.** One user signs in, asks,
  sees an answer, end-to-end — then widen.
- **Each phase has a measurable exit gate.**
- **Strict-$0 through Phase 1.** Paid services light up only when paying
  customers exist.
- **Dogfood from Phase 0.** Our own marketing site / docs / status page /
  changelog use `<nlq-data>` as soon as it exists.

---

## 2. Prerequisites — accounts & keys ($0, no card, <2h total)

### 2.1 Domains (owned)

- [ ] `nlqdb.com` on Cloudflare DNS — **Cloudflare Free plan** (see below).
- [ ] `nlqdb.ai` on Cloudflare DNS; apex 301 → `nlqdb.com` (§2.1 design).
      **Cloudflare Free plan** for this zone too.

**Cloudflare plan per zone: Free ($0/mo/zone).** Both `nlqdb.com` and
`nlqdb.ai` run on Cloudflare's Free tier through Phase 2. What that
buys us (and its limits) — copied directly from the plan card at
`dash.cloudflare.com` → *Add a site* → Free:

| Capability                              | Free tier                           |
| :-------------------------------------- | :---------------------------------- |
| DNS                                     | Fast, unlimited queries             |
| Global CDN                              | Unlimited bandwidth, full coverage  |
| Universal SSL                           | Edge + origin (ECC)                 |
| Application-layer DDoS                  | Unmetered                           |
| Rate limiting                           | IP-based only                       |
| WAF                                     | High-severity / widespread vulns    |
| Bot management                          | Common bots only                    |
| Page / transform / origin rules         | 70 total                            |
| Custom Cloudflare Rules                 | 5                                   |
| Custom WAF Rules                        | 5                                   |
| Support                                 | Community + docs                    |

**Why Free suffices through Phase 2:**
- No SLA or managed-WAF rules needed pre-PMF.
- 5 custom rules are enough for the two gates we care about: block
  POSTs outside `/v1/*` at the edge, and cache all `GET /v1/ask` by
  `(schema_hash, query_hash)` (§4.4 DESIGN).
- Workers / KV / D1 / R2 / Queues / Workers AI / Durable Objects are
  priced per-request, not per-zone — Free plan doesn't cap them (see
  §2.3).
- Custom embed domains (Phase 2) use **Cloudflare for SaaS**, whose
  first 100 zones are free independent of the plan on `nlqdb.com`.

**Upgrade triggers (re-evaluate per `IMPLEMENTATION §8`):**
- Sustained L7 attack that the free WAF doesn't classify → Pro ($25/mo).
- Needing more than 5 custom Cloudflare Rules or 5 custom WAF Rules.
- Needing Argo Smart Routing or Load Balancing (unlikely pre-Phase 3).
- Requiring business-hour support SLA — Enterprise only; revisit at
  Phase 4.

**DNS migration from GoDaddy (both zones):** `nlqdb.com` and `nlqdb.ai`
are registered at GoDaddy. Cloudflare's *Add a site* wizard scans the
registrar and imports existing records. For our starting state **we
delete every imported record** before hitting *Continue*:

| Record (as imported) | Action | Why |
| :------------------- | :----- | :-- |
| `A @ → 13.248.243.5` / `76.223.105.230` | delete | GoDaddy parking-page IPs; Phase 0 points apex at Cloudflare Pages. |
| `CNAME _domainconnect → …gd.domaincontrol.com` | delete | GoDaddy Domain Connect; useless off GoDaddy DNS. |
| `CNAME www → nlqdb.com`                  | delete | Re-add cleanly when Pages is wired. |
| `TXT _dmarc → rua=…onsecureserver.net`   | delete | GoDaddy's DMARC aggregator; we set a real SPF/DKIM/DMARC when Resend lands in Phase 1. |

At GoDaddy (once, per zone): `dcc.godaddy.com` → *My Products* →
`<zone>` → *DNS* → *Nameservers* → *Change* → *"I'll use my own
nameservers"* → paste the two Cloudflare-assigned NS → Save. The
parked-page shows until NS propagation completes (5–30 min typical);
no other GoDaddy-side cleanup is required.

**Assigned nameservers** (Cloudflare picks 2 at zone creation; these
are permanent for the life of the zone, not rotated):

| Zone         | NS 1                       | NS 2                     |
| :----------- | :------------------------- | :----------------------- |
| `nlqdb.com`  | `jeremy.ns.cloudflare.com` | `kiki.ns.cloudflare.com` |
| `nlqdb.ai`   | _(assigned on add-a-site)_ | _(assigned on add-a-site)_ |

**DNSSEC kill-switch (CRITICAL).** If DNSSEC is enabled on the domain
at GoDaddy, switching NS without disabling it first **breaks the
domain** (resolvers return SERVFAIL because the DS records no longer
match). Ordered steps:

1. GoDaddy → the domain → *DNSSEC* → **Disable / Off**. Wait 1–2 min
   for GoDaddy's DS records to clear from `.com` TLD.
2. GoDaddy → *Nameservers* → *Change* → paste Cloudflare NS → Save.
3. Optionally, after the zone is active on Cloudflare, re-enable
   DNSSEC from the Cloudflare dashboard (*DNS* → *Settings* →
   *DNSSEC*), then copy the DS record Cloudflare gives you back to
   GoDaddy's *DNSSEC* page.

**Flip sequencing (verified 2026-04-24 against the live wizard).**
Cloudflare Pages *blocks* Custom-Domain attachment until the zone
is fully active (`"Transfer your DNS to Cloudflare. Once the
transfer is complete, you'll be able to add this Custom Domain to
your Pages project."`). Pending zones cannot pre-bind, so we
cannot eliminate the propagation gap from the Pages side — only
minimise it. Actual sequence:

1. Keep the Cloudflare zone pending; deploy `apps/coming-soon/` to
   the `*.pages.dev` URL via `scripts/deploy-coming-soon.sh`.
   Pre-launch traffic to `nlqdb-coming-soon.pages.dev` already
   works on HTTPS via Cloudflare's shared cert.
2. When committing to the domain flip: GoDaddy → *DNSSEC* →
   **disable** → wait 1-2 min → *Nameservers* → change to the
   assigned Cloudflare pair → save.
3. Wait 5-30 min for zone activation (Cloudflare emails you).
4. Pages project → *Custom domains* → *Set up a custom domain* →
   pick **Cloudflare DNS** method (not *My DNS provider* — that is
   for split-horizon cases where DNS stays authoritatively
   elsewhere) → enter `nlqdb.com`; repeat for `www.nlqdb.com`.
   Cloudflare auto-creates CNAMEs in the now-active zone and
   provisions SSL (~3-5 min).

**Visitor-facing gap** during the 5-30 min between step 2 and
step 4's cert issuance: a mixed experience. Resolvers whose NS
cache is still warm serve the old GoDaddy parking page; resolvers
that have propagated to Cloudflare NS return
`This domain is not configured` until the custom domain is
attached and SSL provisions. Acceptable for a pre-launch domain;
unacceptable in steady state. For the later
`coming-soon → apps/web` swap, we reassign the Pages
custom-domain binding between two projects — a ~30-second
dashboard action that doesn't touch NS.

### 2.1.1 Inbound email — Cloudflare Email Routing (free)

Both zones use **Cloudflare Email Routing** (Free plan feature;
included with the zone, no extra SKU) for `hello@`, `security@`,
`contact@`, `abuse@` etc. Forwards inbound to the founder's existing
inbox; up to 200 addresses per zone, unlimited volume, no card.

| Capability              | Email Routing                         |
| :---------------------- | :------------------------------------ |
| Inbound forwarding      | ✅ Yes, unlimited volume              |
| Outbound ("send as")    | ❌ No — use Resend (§2.5)             |
| Mailbox hosting         | ❌ No — forwards only                 |
| Custom addresses        | Up to 200 rules per zone              |
| Catch-all               | ✅ Yes                                |
| MX / SPF auto-setup     | ✅ Cloudflare auto-writes the records |

**DKIM / DMARC:** Resend's DKIM is set up when outbound email lands in
Phase 1 (§2.5). DMARC is set after both inbound (Email Routing) and
outbound (Resend) are aligned — premature DMARC breaks mail flow.

**Setup sequence (per zone, once NS are flipped):**
1. Dashboard → the zone → *Email* → *Email Routing* → *Get started*.
2. Cloudflare writes MX + SPF records automatically.
3. Add the destination email (founder's real inbox); Cloudflare sends
   a one-time verification link — click it.
4. Create forwarding rules: `hello@` → `$FOUNDER_EMAIL`, catch-all
   `*@` → `$FOUNDER_EMAIL`.
5. Update the coming-soon page's `mailto:` link from the placeholder
   to `hello@nlqdb.com`.

### 2.2 Identity / source / distribution

- [ ] GitHub org `nlqdb` — branch protection, required reviews, secret
      scanning, Dependabot.
- [ ] npm org `nlqdb` (reserves `@nlqdb/*`).
- [ ] `nlqdb/homebrew-tap` (GitHub repo).
- [ ] ~~Docker Hub org `nlqdb`~~ → **skipped**. Docker removed the
      free-org tier (Team plan now starts at $15/seat/mo = ~$180/yr),
      which conflicts with the strict-$0 budget. Self-host images
      (if/when we ship them in Phase 3+) publish to **GitHub
      Container Registry** under `ghcr.io/nlqdb/<image>` — free for
      public images, integrated with the existing `nlqdb` GH org,
      no extra account.

### 2.3 Hosting / runtime (§7 design)

- [ ] **Cloudflare** — Pages, Workers, KV, D1, R2, Queues, Workers AI,
      Durable Objects. Capture `CLOUDFLARE_ACCOUNT_ID`,
      `CLOUDFLARE_API_TOKEN` (scoped), `CF_AI_TOKEN`.
- [ ] **Neon** — `NEON_API_KEY`. Every Neon project uses
      **Postgres 17** (GA). Postgres 18 is in preview on Neon as of
      Feb 2026; we move to 18 via in-place upgrade once Neon promotes
      it GA. **Neon Auth (Stack Auth integration) is OFF** on every
      project — auth lives in Cloudflare Workers via Better Auth
      (DESIGN §4), not in the tenant DB. Neon Auth tables would
      pollute every tenant schema and couple users to a single DB,
      which contradicts our schema-per-DB tenancy model.
- [ ] **Upstash** — `UPSTASH_REDIS_REST_TOKEN`.
- [ ] **Fly.io** — `FLY_API_TOKEN` (for Listmonk / Plausible / Lago).

### 2.4 LLM inference (§8.1 design — all no-card)

- [ ] Google AI Studio — `GEMINI_API_KEY` (500 RPD Flash / 100 RPD Pro).
- [ ] Groq Cloud — `GROQ_API_KEY` (14,400 RPD 8B / 1,000 RPD 70B).
- [ ] OpenRouter — `OPENROUTER_API_KEY` (fallback only).
- [ ] Cloudflare Workers AI — covered by `CF_AI_TOKEN`; 10k Neurons/day.
- [ ] Ollama on every dev laptop (Llama 3.2 3B, Qwen 2.5 7B) for local dev.

**Optional (apply Day 1, don't block):** Anthropic / OpenAI / Google
Cloud for Startups / Modal startup credits.

### 2.5 Auth / email / payments

- [ ] `BETTER_AUTH_SECRET` (self-generated). §4.3 design is the full spec.
- [ ] `INTERNAL_JWT_SECRET` — Workers-only; signs 30s internal JWTs (§4.4).
- [x] **GitHub OAuth app — `nlqdb-web` (prod)** →
      `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`. The
      `OAUTH_*` prefix avoids GitHub Actions' reserved `GITHUB_*`
      namespace (repo/org secrets prefixed `GITHUB_` are rejected),
      keeping local + CI + Workers names 1:1 for clean mirroring.
      Single callback URL per OAuth App:
      `https://app.nlqdb.com/auth/callback/github`. Device flow
      enabled (CLI `nlq login` per §3.3 design); device-code flow
      polls and never invokes the callback. Configured details in
      [`RUNBOOK §5b`](./RUNBOOK.md#5b-github-oauth--whats-configured).
- [x] **GitHub OAuth app — `nlqdb-web-dev`** →
      `OAUTH_GITHUB_CLIENT_ID_DEV`, `OAUTH_GITHUB_CLIENT_SECRET_DEV`.
      Second OAuth App under the `nlqdb` org with callback
      `http://localhost:8787/auth/callback/github` (Wrangler dev —
      Better Auth lives in Workers per §4 design). Required because
      GitHub OAuth Apps support exactly one callback URL each.
      Live-verified via the same `/applications/{id}/token` probe as
      prod (HTTP 404 = pair accepted). Better Auth will pick prod vs
      dev credentials based on `NODE_ENV` / Wrangler env when the
      auth code lands in Phase 0 §3.
- [x] **Google OAuth client** → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
      (same redirect set). GCP project: `nlqdb`. OAuth consent screen
      in **Testing** mode; publishing-to-production (and therefore
      verification) deferred until Phase 1 public launch. Scopes:
      `openid`, `/auth/userinfo.email`, `/auth/userinfo.profile` —
      all non-sensitive, so verification when submitted will be fast
      (days, not weeks). Client name: `nlqdb-web`. Redirect URIs and
      JS origins enumerated in [`RUNBOOK.md §5`](./RUNBOOK.md).
- [ ] CLI build dep: `github.com/zalando/go-keyring` (OS keychain).
- [x] **Resend** → `RESEND_API_KEY` (free tier, 3k emails/mo). API key
      live-verified via `verify-secrets.sh`. Domain verification for
      `nlqdb.com` (SPF/DKIM/DMARC) deferred to Phase 1 — no outbound
      mail until magic-link sign-in lands.
- [ ] ~~**AWS SES** (fallback)~~ → **dropped from Phase 0/1**.
      AWS account creation requires a credit card — violates strict-$0.
      Resend free tier (3k emails/mo, 100/day) is overkill for
      pre-PMF traffic; a fallback is only worth provisioning if/when
      we hit the Resend ceiling or experience an outage. When that
      happens, prefer card-free alternatives (Postmark / MailerSend /
      Loops) over AWS SES.
- [x] **Stripe** (test mode) → `STRIPE_SECRET_KEY`,
      `STRIPE_PUBLISHABLE_KEY`. Both live-verified (`sk_test_…` /
      `pk_test_…`). Merchant: Switzerland / CHF; statement descriptor
      `NLQDB.COM`. Stripe Tax to enable when going live in Phase 2.
- [ ] **Stripe webhook secret** → `STRIPE_WEBHOOK_SECRET`. Phase 0 §3
      — needs `apps/api` to host the webhook endpoint before the
      signing secret can be minted.

### 2.6 Observability

- [x] **Sentry** → `SENTRY_DSN` (5k errors/mo free). Live-verified.
- [ ] **Plausible** — self-hosted on Fly (no SaaS key). Phase 1.
- [x] **Grafana Cloud OTLP** →
      `GRAFANA_CLOUD_API_KEY`,
      `GRAFANA_CLOUD_INSTANCE_ID`,
      `GRAFANA_OTLP_ENDPOINT`. Stack `nlqdb` on `us-east-2`,
      instance `1609127`, access policy `nlqdb-phase0-telemetry` with
      `metrics:write` + `logs:write` + `traces:write`. Live-verified
      via empty OTLP envelope POST (HTTP 200/400/415 = auth accepted).

SLOs, per-stage latency budgets, span/metric catalog, sampling rules,
and the slice-by-slice instrumentation hooks live in
[`PERFORMANCE.md`](./PERFORMANCE.md). Slice 3 (Neon adapter) is the
first slice that emits OTel spans — it must ship the SDK + exporter
wiring per `PERFORMANCE.md §4`.

### 2.7 Secret management

Three concentric scopes:

1. **Local dev** — `.envrc` (gitignored), loaded by `direnv`. Encrypted
   backup at `~/Library/Mobile Documents/.../nlqdb-backups/.envrc.age`
   (out of repo, see `RUNBOOK §8`).
2. **CI (GitHub Actions)** — mirrored from `.envrc` via
   `scripts/mirror-secrets-gha.sh` (idempotent; values read via
   `--body -` so they never reach argv / ps / shell history). Names are
   1:1 with `.env.example` *minus* `BETTER_AUTH_SECRET` +
   `INTERNAL_JWT_SECRET` (CI generates ephemeral values per run; sharing
   dev values to CI would let CI compromise live dev sessions). Re-run
   the script whenever a credential rotates.
3. **Runtime (Cloudflare Workers)** — Phase 0 §3 pending; will mirror
   from `.envrc` via `wrangler secret put` once `apps/api` exists.

`.env.example` is the canonical name list — adding a secret requires
updating `.env.example` AND the `SECRETS=` array in
`scripts/mirror-secrets-gha.sh` simultaneously.

### 2.8 Dev toolchain (zero-config — `scripts/bootstrap-dev.sh`)

A single script stands up every local tool, pulls Ollama models, seeds
`.envrc` from `.env.example`, installs workspace deps, and wires git
hooks. A dev with a clean machine runs it once.

| Purpose                        | Tool                              |
| :----------------------------- | :-------------------------------- |
| JS/TS runtime + package mgr    | **Bun** (`bun@1.3+`)              |
| Python envs + tools            | **uv**                            |
| Go CLI                         | Go 1.24+                          |
| JS/TS/JSON/CSS format + lint   | **Biome**                         |
| Go format                      | **gofumpt**                       |
| Go lint                        | **golangci-lint**                 |
| Python format + lint           | **ruff**                          |
| Git hooks (pre-commit/push)    | **lefthook**                      |
| Cloud CLIs                     | wrangler (via Bun), flyctl, aws, stripe, gh |
| Local LLM                      | Ollama (`llama3.2:3b`, `qwen2.5:7b`) |
| Env / secrets loader           | direnv                            |

Rationale: one binary per job, all Rust- or Go-compiled, sub-second
runtime budget on a monorepo we expect to reach 200k+ LOC. Prettier +
ESLint + husky are explicitly out — they are slow enough that devs
disable them, and Biome + lefthook cover the same surface in a single
install with ~10× the throughput.

Commit-message policy: **Conventional Commits** (enforced by lefthook
`commit-msg` hook; same list of types as release-please / semantic-release).

**Total Day-1 spend: $0.** Recurring: ~$7/mo amortized domains.

---

## 3. Phase 0 — Foundations

**Theme:** the stack stands up end-to-end for one developer. No traffic.

- DNS per §2.1.
- Monorepo `nlqdb/nlqdb` with **Bun workspaces** (`bun@1.3+`, pinned via
  `package.json#packageManager`): `apps/web` (Astro), `apps/api`
  (Workers), `packages/{sdk, elements, mcp, llm, auth-internal}`,
  `cli/` (Go). Python tooling (ad-hoc scripts, notebooks) managed by
  **uv** — no `pip` / `venv` ad-libbing.
- **Formatter + linter + git hooks:**
  - [Biome](https://biomejs.dev) — single binary formatter + linter for
    JS/TS/JSON/CSS/Astro. Config at `biome.json`. Replaces
    Prettier + ESLint end-to-end.
  - **gofumpt** + **golangci-lint** for the Go CLI.
  - **ruff** (format + lint) for any Python.
  - [**lefthook**](https://lefthook.dev) wires them into `pre-commit`
    (fix-and-stage), `commit-msg` (Conventional Commits), `pre-push`
    (whole-repo Biome + `go vet`). Config at `lefthook.yml`.
  - CI runs the same Biome / golangci-lint / ruff commands via the
    reusable workflow (§13 design) — hooks are the first line of
    defense, CI is the backstop.
- Reusable CI per `DESIGN §13`: `nlqdb/actions@v1`, 4-line consumer.
- Cloudflare Pages + Workers + KV + D1 + R2 provisioned via wrangler
  from CI.
- `llm/` adapter (`classify|plan|summarize|embed`) with the strict-$0
  provider chain (§8.1 design). One test per provider per endpoint.
- Plan cache in KV keyed by `(schema_hash, query_hash)`.
- **Auth scaffold** (Better Auth, magic link + GitHub OAuth,
  anonymous-mode adoption; §4 design):
  - Device endpoints: `POST /v1/auth/{device, device/token, refresh,
    logout}`. `device` returns `verification_uri_complete` (code in URL
    query param) so the approval page is one-click.
  - Approval page `nlqdb.com/device` — reads `?code=`, shows one button
    + device user-agent + coarse geo. Fallback manual-code form for SSH.
  - Refresh-token rotation; KV revocation set keyed by `jti`.
  - Internal JWT signer (`packages/auth-internal`); downstream consumers
    (plan cache, pool, LLM router) each have a test proving they reject
    unsigned calls.
  - Key storage: Argon2id-hashed `pk_live_` / `sk_live_` / `sk_mcp_*` in
    D1 with last-4 cleartext suffix for display.
- One Postgres adapter (Neon HTTP) + schema-per-DB tenancy.
- `POST /v1/ask` end-to-end (goal → DB → schema inferred → row
  inserted/queried → response). Internal.

**Exit gate:** curl to `/v1/ask` returns a real answer from real Postgres
in <2s p50; reusable CI goes green in <90s on a trivial PR; provider
chain exercised with forced failover; $0 spent.

**Out of scope:** chat UI, marketing site, CLI, MCP, embed element, billing.

---

## 4. Phase 1 — On-ramp (public soft launch)

**Theme:** the goal-first 60-second flow works for a stranger.

- **Marketing site** `nlqdb.com` (static Astro). Single hero input. AEO
  basics: JSON-LD `SoftwareApplication`, `llms.txt`, `sitemap.xml`,
  AI-crawler-permissive `robots.txt`.
- **Chat surface** `app.nlqdb.com` (one Astro route + React island).
  Streaming, three-part response, Cmd+K, Cmd+/ trace, in-place edit + re-run.
- **Anonymous-mode end-to-end** (72h, localStorage token; adopt via one
  SQL row on sign-in).
- **Sign-in:** magic link + GitHub OAuth (Google deferred). Cookie
  `__Host-session` (HttpOnly / SameSite=Lax / Secure).
- **Silent refresh + seamless re-auth** on the web per §4.3 design:
  401 → refresh; refresh fail → `/sign-in?return_to=…` preserving the
  pending action.
- **API keys:** `pk_live_` + `sk_live_` from the dashboard. `sk_mcp_*`
  arrives with the CLI in Phase 2.
- **Settings → Keys** page (list/create/rotate/revoke per §4.5 design;
  last-4, host, device, last-used, coarse IP; ≤2s revocation).
- **`<nlq-data>` v0** — `goal=`, `db=`; templates `table`, `list`, `kv`
  (others Phase 2). Distributed via `elements.nlqdb.com` → R2.
- **"Copy snippet" / "Copy starter HTML"** (§14.5, §16 design) — every
  chat-generated embed has the user's `pk_live_` pre-inlined. Anonymous
  users get a temporary key rotated into `pk_live_` on sign-in.
- **Hello-world tutorial** (§16) at `nlqdb.com/hello-world`, pinned in README.
- **Resend** wired (one template: magic link). **Sentry** + **Plausible** wired.

**Exit gate:**
- 4/5 unguided user-tests complete the 60s on-ramp.
- 1 P1 solo-builder ships a real side-project using only `<nlq-data>` + chat.
- Lighthouse 100/100/100/100.
- p50 < 400ms (cache hit), p95 < 1.5s (cache miss).
- Free-tier LLM sustains 200 launch-day signups without exceeding any RPD.
- Still $0/mo.

**Out of scope:** CLI, MCP, billing, teams, non-Postgres engines,
Workload Analyzer.

---

## 5. Phase 2 — Agent + developer surfaces

**Theme:** make it a developer ecosystem. Aligns with P2.

- **CLI `nlq`** (Go). Default: `nlq new`, bare `nlq "…"`. Power-user:
  `nlq db create|list`, `nlq query`, `nlq chat`. Distribution:
  `curl | sh`, Homebrew tap, npm shim.
  - **Auth surface** (§3.3, §4.3 design): `nlq login` (device-code),
    `nlq logout`, `nlq whoami`, `nlq keys list|rotate|revoke`.
    Anonymous-first.
  - **Storage:** `zalando/go-keyring`; fallback AES-GCM file at
    `~/.config/nlqdb/credentials.enc` machine-keyed. No plaintext path
    exists in the binary.
  - **Silent refresh** middleware; 401 → refresh-and-retry once; refresh
    fail → re-run device flow in-place.
  - **CI mode:** `NLQDB_API_KEY` short-circuits everything above.
- **MCP server `@nlqdb/mcp`** (npm). Tools: `nlqdb_query`,
  `nlqdb_list_databases`, `nlqdb_describe`.
  - **`nlq mcp install`** (no-arg default, §3.4 design): auto-detect
    Claude Desktop / Cursor / Zed / Windsurf / VS Code / Continue; print
    what was found; sign in if needed; mint `sk_mcp_<host>_<device>_…`;
    write host config; restart Claude Desktop when running; self-check.
    Flags `--all`, `--dry-run`. Explicit `<host>` is the power-user
    override.
  - **Website one-click** `app.nlqdb.com/mcp` (server-side key + deep
    link; short-lived helper binary when CLI missing).
  - **Per-host DB isolation** — DBs tagged `(mcp_host, device_id)` in
    D1; promote-to-account via one-click dashboard action.
  - **CI invariant:** `@nlqdb/mcp`'s lockfile must contain zero DB
    drivers; CI fails any PR adding `pg` / `postgres` / `redis` / etc.
- **`<nlq-action>` element** — write counterpart to `<nlq-data>`;
  form-field-to-column inference.
- **CSV upload** in the chat (unlocks P3 per `PERSONAS.md`).
- **Custom domains for embed** via Cloudflare for SaaS (first 100 zones free).
- **Stripe** live (Hobby $10; pricing page).
- **Lago** + **Listmonk** on Fly.
- **Docs site** `docs.nlqdb.com` (MDX, full-text search).

**Exit gate:**
- MCP installed in 3+ distinct host apps in the wild.
- 1 agent product publicly uses nlqdb as memory.
- 3 non-engineers (P3) complete a CSV analysis in <10 min unassisted.
- 5 paying Hobby customers.
- Inference cost < $1/mo per paying customer (Lago vs. invoices).

**Out of scope:** auto-migration, non-Postgres engines, teams.

---

## 6. Phase 3 — The engine (the moat)

- Query Log → Workload Analyzer → Migration Orchestrator (PLAN §2.1–§2.2).
- Add **Redis (Upstash)** as second engine (shadow-write + dual-read
  verifier + atomic cutover).
- Add **DuckDB** as third engine for analytics.
- **Pro tier** live ($25/mo usage-based).
- **Self-hosted classifier** on single A10G Modal once ~50k queries/day.
- **Continuous backups** to R2 with PITR (7d free, 30d Hobby+).
- **Team workspaces** (Owner/Member/Public).
- **Self-host container image** published to `ghcr.io/nlqdb/api`
  (and `ghcr.io/nlqdb/cli` if demand exists) — free public registry
  under the `nlqdb` GH org (§2.2). Docker Hub is off-limits due to
  the paid-org-only tier change; GHCR is the canonical distribution
  point for any OCI image we ship.

**Exit gate:** ≥100 successful auto-migrations with zero user-visible
downtime; Workload Analyzer beats a hand-tuned baseline on a held-out
benchmark; weekly restore drill passes; 50 paying customers across tiers.

---

## 7. Phase 4+ — Beyond v1

Covered in `PLAN §8` and `DESIGN §10–§12`: BYO Postgres (P4 unblock),
enterprise (SSO, audit log, on-prem), more engines (pgvector at scale,
ClickHouse, TimescaleDB, Typesense), `<nlq-stream>`.

---

## 8. Cross-phase, always-on

- **Build-in-public cadence** per `DESIGN §5.3`.
- **Security hygiene:** Trivy + CodeQL on every PR; secret rotation
  quarterly; Dependabot monthly.
- **Inference cost monitoring:** weekly Grafana; if any free provider
  exceeds 70% of daily quota for 3 days running, light up paid tier +
  file a ticket.
- **Free-tier abuse:** per-IP + per-account rate limits Day 1; PoW on
  signup if needed; anomaly detection Phase 2.
- **Provider-swap drill:** quarterly forced LLM failover in production
  for 1h.
- **Backup-restore drill:** weekly automated restore + diff; failure pages on-call.

---

## 9. Explicitly **not** doing

Per `DESIGN §12`: no visual schema editor, no query builder, no
migrations tool, no mobile app, no GraphQL, no "Sign in with nlqdb" IdP,
no on-prem before Phase 4, no paid ads pre-PMF. Answer for any of the
above is "after Phase 3 exit gate, re-evaluate" — not "yes, but later."

---

*Living document. Phases are dependency-ordered acceptance gates, not
calendar windows.*
