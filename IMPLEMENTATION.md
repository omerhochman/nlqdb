# nlqdb — Implementation Plan

This document is the **execution plan** for the design captured in
[`DESIGN.md`](./DESIGN.md) and the broader phased roadmap in
[`PLAN.md`](./PLAN.md). It answers two practical questions:

1. **What do we build, in what order, with what dependencies?** (§3–§7)
2. **What accounts and API keys do we need to provision first, all $0?** (§2)

It deliberately does **not** restate design rationale. If you're asking
*why* something is a certain way, read `DESIGN.md`. If you're asking
*what to do next this week*, read this.

---

## 1. Operating principles for execution

Adapted from [`DESIGN.md` §0](./DESIGN.md), translated to execution rules:

- **Ship the on-ramp first.** The single most-used path (the goal-first
  homepage flow → first answer in the chat) ships before anything else.
  Every subsequent phase strengthens that path; nothing is built that
  doesn't serve a real user goal already in flight.
- **Vertical slices, not horizontal layers.** We do not build "the auth
  system" then "the chat" then "the CLI". We build *one user can sign in,
  ask one question, see one answer*, end-to-end, then widen.
- **Each phase has an exit gate.** A phase is "done" only when the gate's
  acceptance criteria pass — measured, not asserted.
- **Strict-$0 until first paying customer.** Phase 0 and Phase 1 spend $0
  beyond the ~$85/yr in domains. Paid services light up only when
  customers exist to amortize them.
- **Dogfood from Phase 0.** Our own marketing site, docs, status page,
  and changelog are built with `<nlq-data>` as soon as it exists. If we
  can't ship our own site with it, no one else can.

---

## 2. Prerequisites — accounts and API keys to provision (all $0, no card)

This is the **literal checklist** to run through before writing line one
of code in Phase 0. Everything here is free, requires no credit card, and
takes <2 hours total.

### 2.1 Domains (already owned)

- [ ] `nlqdb.com` — set up Cloudflare as DNS provider (free).
- [ ] `nlqdb.ai` — set up Cloudflare as DNS provider (free); apex 301 to
      `nlqdb.com` per [`DESIGN.md` §2.1](./DESIGN.md).

### 2.2 Identity / source / distribution

- [ ] **GitHub organization** `nlqdb` — free for OSS repos. Enable:
      branch protection, required reviews, secrets scanning, Dependabot.
- [ ] **npm organization** `nlqdb` — free; reserves the `@nlqdb/*` scope
      ([`DESIGN.md` §3.3](./DESIGN.md)).
- [ ] **Homebrew tap** repo `nlqdb/homebrew-tap` — free GitHub repo, no
      account beyond GitHub.
- [ ] **Docker Hub** `nlqdb` org — free; for the optional self-host image.

### 2.3 Hosting / runtime (the strict-$0 stack from [`DESIGN.md` §7](./DESIGN.md))

- [ ] **Cloudflare** account (free tier). Enable: Pages, Workers, KV, D1,
      R2, Queues, Workers AI, Durable Objects (SQLite-backed). Capture:
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN` (scoped: Workers, Pages, KV, D1, R2, Workers AI)
  - `CF_AI_TOKEN` (Workers AI specifically — used by `llm/` adapter)
- [ ] **Neon** account (free tier — 0.5GB, scale-to-zero) for user DBs.
      Capture `NEON_API_KEY`.
- [ ] **Upstash** account (free tier — 10k cmds/day) for Redis-backed
      user DBs. Capture `UPSTASH_REDIS_REST_TOKEN`.
- [ ] **Fly.io** account (free tier — 3 small machines) for self-hosted
      Listmonk, Plausible, Lago. Capture `FLY_API_TOKEN`.

### 2.4 LLM inference (the strict-$0 path from [`DESIGN.md` §8.1](./DESIGN.md))

All providers below are **no-card, no-credits-required**. We add paid
providers only when usage justifies it.

- [ ] **Google AI Studio** — sign in with Google account. Capture
      `GEMINI_API_KEY`. Confirms: 500 RPD on Gemini 2.5 Flash, 100 RPD
      on Gemini 2.5 Pro, 250k TPM.
- [ ] **Groq Cloud** — capture `GROQ_API_KEY`. Confirms: 14,400 RPD on
      Llama 3.1 8B Instant, 1,000 RPD on Llama 3.3 70B.
- [ ] **OpenRouter** — capture `OPENROUTER_API_KEY`. Used **only** as
      fallback for `:free` models when Gemini and Groq both fail.
- [ ] **Cloudflare Workers AI** — already covered by `CF_AI_TOKEN` above.
      Confirms 10,000 Neurons/day for embeddings.
- [ ] **Ollama** installed on every developer's laptop (Llama 3.2 3B
      and Qwen 2.5 7B pulled). Used for local dev only — zero network
      cost while iterating on prompts.

**Optional (apply once, takes weeks to land — start the application Day 1
but do not block on it):**

- [ ] Anthropic startup credits (~$2.5–10k typical).
- [ ] OpenAI startup credits (varies).
- [ ] Google Cloud for Startups (Gemini paid-tier credits).
- [ ] Modal startup credits (for self-hosting the classifier later).

### 2.5 Auth / email / payments (Phase 1 onwards; capture keys upfront)

- [ ] **Better Auth** — open-source library, no account needed; the only
      thing to capture is the secret we'll generate ourselves
      (`BETTER_AUTH_SECRET`). See [`DESIGN.md` §4.3](./DESIGN.md) for the
      full session-lifecycle spec that Phase 0 implements.
- [ ] **Internal JWT signer secret** (`INTERNAL_JWT_SECRET`) — generated
      ourselves, Cloudflare-Workers-only, never exposed. Signs the short-
      lived (30s) JWTs used for every edge-to-downstream call per
      [`DESIGN.md` §4.4](./DESIGN.md).
- [ ] **GitHub OAuth app** for "Sign in with GitHub" — capture
      `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. Redirect URIs must
      include `https://app.nlqdb.com/auth/callback/github` and
      `https://nlqdb.com/device/approve` (for the CLI device-code flow).
- [ ] **Google OAuth client** in Google Cloud Console — capture
      `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Same redirect URI set.
- [ ] **OS keychain libraries** for the CLI build:
      `github.com/zalando/go-keyring` (zero runtime cost; cross-platform).
      No account / key to capture — just a build dependency called out
      here so it isn't forgotten.
- [ ] **Resend** account (free tier — 3k/mo, 100/day) — capture
      `RESEND_API_KEY`. Configure SPF, DKIM, DMARC for `nlqdb.com`.
- [ ] **AWS** account (free tier — 62k SES emails/mo from EC2) as
      fallback. Capture `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- [ ] **Stripe** account (no fees until first charge) — capture
      `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
      `STRIPE_WEBHOOK_SECRET`. Enable Stripe Tax. **Test mode only**
      until Phase 2.

### 2.6 Observability (free tiers only)

- [ ] **Sentry** account (free — 5k errors/mo). Capture `SENTRY_DSN`.
- [ ] **Plausible Analytics** — self-hosted on Fly free machine in §3.4;
      no SaaS account needed.
- [ ] **Grafana Cloud** account (free — 10k metrics, 50GB logs). Capture
      `GRAFANA_CLOUD_API_KEY`, `GRAFANA_OTLP_ENDPOINT`.

### 2.7 Secret management

- [ ] All keys above stored in **GitHub Actions secrets** (org-level for
      shared, repo-level for repo-specific) and **Cloudflare Workers
      secrets** for runtime.
- [ ] Local dev uses **`direnv`** + a per-developer `.envrc` (gitignored)
      — never committed.
- [ ] One **`.env.example`** file in each repo lists every variable name
      with a short comment. No values, ever.

**Total Day-1 spend: $0.** Recurring cost: ~$7/month amortized for the
two domains.

---

## 3. Phase 0 — Foundations (the week before users see anything)

**Theme:** the stack stands up, end-to-end, with one developer hitting
"Hello world" through every layer. No public traffic.

**Scope:**

- Wire DNS for `nlqdb.com` and `nlqdb.ai` per §2.1.
- Bootstrap a single **monorepo** (`nlqdb/nlqdb`) with `pnpm` workspaces:
  `apps/web` (Astro), `apps/api` (Workers), `packages/sdk`,
  `packages/elements`, `packages/mcp`, `packages/llm`, `cli/` (Go).
- Stand up the reusable CI/CD per [`DESIGN.md` §13](./DESIGN.md):
  separate `nlqdb/actions` repo with the reusable workflow at `@v1`,
  consumer 4-line `ci.yml` in `nlqdb/nlqdb`.
- Provision Cloudflare Pages (web), Workers (api), KV (sessions + plan
  cache), D1 (control plane), R2 (backups + elements CDN). All via
  `wrangler` from CI, no console clicks beyond initial OAuth.
- Implement the **`llm/` adapter** with the provider chain from
  [`DESIGN.md` §8.1](./DESIGN.md). Endpoints: `classify`, `plan`,
  `summarize`, `embed`. Day-1 chain order: Gemini Flash → Groq Llama 70B
  → OpenRouter free → (skip paid). One unit test per provider for each
  endpoint.
- Implement the **plan cache** (KV, content-addressed by
  `(schema_hash, query_hash)`) — the single biggest cost lever per
  [`PLAN.md` §5.1](./PLAN.md).
- Implement the **auth scaffold** with Better Auth per [`DESIGN.md` §4](./DESIGN.md):
  magic link, GitHub OAuth, anonymous-mode adoption window. No UI yet
  beyond a utilitarian sign-in page.
  - **Device authorization endpoints**: `POST /v1/auth/device`,
    `POST /v1/auth/device/token`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`.
    All specified in [`DESIGN.md` §4.3](./DESIGN.md). These ship in Phase 0
    even though the CLI that consumes them is Phase 2 — they're shared
    with the web app's sign-in flow and cheap to test standalone.
  - **Refresh-token rotation**: every refresh issues a new refresh token;
    prior one is marked used. KV revocation set keyed by `jti`.
  - **Internal JWT signer** ([`DESIGN.md` §4.4](./DESIGN.md)): edge-only
    secret, 30s TTL, signs every downstream call. One utility module in
    `packages/auth-internal`, one unit test per consumer (plan cache, pool,
    LLM router) that verifies they reject unsigned calls.
  - **Key storage**: Argon2id-hashed `pk_live_`, `sk_live_`, `sk_mcp_*` rows
    in D1 with last-4 cleartext suffix for display.
- Implement **one** Postgres adapter (Neon HTTP driver) and the
  schema-per-DB tenancy pattern from [`PLAN.md` §1.6](./PLAN.md).
- Build the **`POST /v1/ask`** endpoint end-to-end (goal → DB created →
  schema inferred → row inserted/queried → response). Internal use only.

**Exit gate:**

- One developer, hitting `curl https://api.nlqdb.com/v1/ask` from the
  command line, gets a real answer back from a real Postgres in <2s p50.
- The reusable CI workflow runs green on a trivial PR in <90s.
- The full `llm/` provider chain has been exercised with one provider
  forcibly disabled, falling through to the next.
- $0 spent so far.

**Out of scope for Phase 0** (intentionally): chat UI, marketing site,
CLI, MCP, embed element, billing. Phase 0 is "the engine runs."

---

## 4. Phase 1 — The on-ramp (public soft launch)

**Theme:** the goal-first 60-second flow from [`DESIGN.md` §0.1
and §3.1](./DESIGN.md) works for a stranger.

**Scope:**

- **Marketing site** (`nlqdb.com`) — static Astro, single hero with
  *"What are you building?"* input. No other pages required at this
  point. AEO/GEO basics: JSON-LD `SoftwareApplication`, `llms.txt`,
  `sitemap.xml`, AI-crawler-friendly `robots.txt`.
- **The chat surface** (`app.nlqdb.com`) — single Astro route + one React
  island. Streaming responses. Three-part response (answer / data /
  trace). Cmd+K palette. Cmd+/ trace toggle. In-place edit + re-run.
- **Anonymous-mode end-to-end** — DB survives 72h on a localStorage
  token; adopted on sign-in with one row of SQL.
- **Sign-in** — magic link + GitHub OAuth (Google deferred). Web uses the
  same `/v1/auth/*` endpoints stood up in Phase 0. Cookie is
  `__Host-session` (HttpOnly, SameSite=Lax, Secure).
- **Silent refresh + seamless re-auth** on the web per [`DESIGN.md`
  §4.3](./DESIGN.md): 401 on any fetch triggers an in-flight refresh; if
  refresh fails, the router opens `/sign-in?return_to=...` with the
  user's pending action preserved.
- **API keys** — `pk_live_` (publishable, origin-pinned, read-only) and
  `sk_live_` (secret), creatable from the dashboard. `sk_mcp_*` is not
  yet exposed (arrives in Phase 2 alongside the CLI).
- **Settings → Keys page**: list, create, rotate, revoke per
  [`DESIGN.md` §4.5](./DESIGN.md); displays last-4 + host + device +
  last-used + coarse IP. Revocation propagates in ≤2s.
- **`<nlq-data>` element** v0 — `goal=` and `db=` attributes;
  templates: `table`, `list`, `kv`. (`card-grid`, `chart` deferred to
  Phase 2.) Distributed via `elements.nlqdb.com` → R2.
- **Hello-world tutorial** ([`DESIGN.md` §16](./DESIGN.md)) — published
  at `nlqdb.com/hello-world` and pinned in the README.
- **Resend** wired for transactional email; one template (magic link).
- **Sentry** + **Plausible** wired.

**Exit gate** (matches the validation criteria in
[`PERSONAS.md`](./PERSONAS.md) for the P0 personas, scoped to Phase 1):

- 5 unstructured user tests confirm the 60-second on-ramp works without
  guidance for at least 4/5 testers.
- One real solo-builder ([P1 in `PERSONAS.md`](./PERSONAS.md)) ships a
  side-project using only `<nlq-data>` and the chat. Their site is in
  the showcase.
- Lighthouse 100/100/100/100 on `nlqdb.com`.
- p50 query latency < 400ms on cache hit; p95 < 1.5s on cache miss.
- Free-tier inference (§2.4) sustains at least 200 strangers signing up
  on a single launch day without exceeding any free-tier RPD ceiling.
- Still $0/month spent.

**Out of scope for Phase 1:** CLI, MCP, billing, team workspaces, any
engine other than Postgres, the Workload Analyzer.

---

## 5. Phase 2 — The agent + developer surfaces

**Theme:** ship the surfaces that turn a single-user toy into a developer
ecosystem. Aligns with P2 (Agent Builder) success criteria in
[`PERSONAS.md`](./PERSONAS.md).

**Scope:**

- **CLI** (`nlq`) — Go binary. Default-path commands first
  (`nlq new "..."`, bare `nlq "..."`); explicit-path commands
  (`nlq db create`, `nlq query`, `nlq chat`) second. Distribution:
  `curl | sh`, Homebrew tap, npm shim.
  - **Auth surface** per [`DESIGN.md` §3.3 and §4.3](./DESIGN.md):
    `nlq login` (device-code), `nlq logout`, `nlq whoami`, `nlq keys
    list|rotate|revoke`. Anonymous-first: bare `nlq "..."` mints an
    anonymous token *before* any sign-in prompt.
  - **Credential storage**: `github.com/zalando/go-keyring` (OS keychain
    on all three platforms). Fallback: AES-GCM encrypted file at
    `~/.config/nlqdb/credentials.enc` with a machine-bound key when the
    keychain isn't available. Plaintext storage is never an option —
    the plaintext code path doesn't exist in the binary.
  - **Silent access-token refresh**: one HTTP middleware; 401 triggers
    refresh-and-retry once, then re-runs the device flow in-place if the
    refresh fails. No user-visible "session expired" state.
  - **CI mode**: `NLQDB_API_KEY` env var short-circuits all of the above
    and is the only supported path for scripts.
- **MCP server** — `@nlqdb/mcp`, published to npm. Tools: `nlqdb_query`,
  `nlqdb_list_databases`, `nlqdb_describe`. (No `nlqdb_create_database`
  tool — DBs materialize on first reference per [`DESIGN.md` §0.1](./DESIGN.md).)
  - **`nlq mcp install <host>`** ([`DESIGN.md` §3.4](./DESIGN.md)): one
    command does sign-in (if needed), mints `sk_mcp_<host>_<device>_…`,
    patches the host's config file at the right path, runs a self-check.
    Targets: Claude Desktop, Cursor, Zed, Windsurf, VS Code, Continue.
  - **Website one-click install**: `app.nlqdb.com/install/<host>` mints
    the scoped key server-side and returns an `nlqdb://install?…` deep
    link the CLI handles. If the CLI isn't installed, the page offers a
    short-lived helper binary that does only the config-file write.
  - **Per-host DB isolation**: DBs created via MCP are tagged with
    `(mcp_host, device_id)` in D1 and hidden from other hosts by default,
    per [`DESIGN.md` §3.4](./DESIGN.md). Promote-to-account is a one-click
    dashboard action.
  - **No DB driver in `@nlqdb/mcp`'s lockfile** — CI fails the build if
    `pg`, `postgres`, `redis`, or any engine client appears, per the
    structural invariant in [`DESIGN.md` §4.4](./DESIGN.md).
- **`<nlq-action>` element** — write counterpart to `<nlq-data>`. Form
  field names are inferred into columns automatically.
- **CSV upload** in the chat — unlocks P3 (Analyst) per
  [`PERSONAS.md`](./PERSONAS.md).
- **Custom domains for embed** (Hobby tier feature) — using Cloudflare
  for SaaS (free for first 100 zones).
- **Stripe** moved out of test mode. Hobby tier ($10) live. Pricing page
  ([`DESIGN.md` §6](./DESIGN.md)) published.
- **Lago** self-hosted on Fly for usage metering.
- **Listmonk** self-hosted on Fly for the newsletter.
- **Docs site** (`docs.nlqdb.com`) — MDX, full-text searchable.

**Exit gate:**

- MCP server installed in 3+ distinct host apps in the wild
  (per [`PERSONAS.md`](./PERSONAS.md) P2 success).
- 1 agent product publicly integrates nlqdb as its memory layer.
- 3 non-engineers ([P3 in `PERSONAS.md`](./PERSONAS.md)) complete a
  real CSV-driven analysis in <10 minutes, unassisted.
- 5 paying Hobby customers.
- Inference cost per paying customer < $1/mo (verified via Lago
  metering against actual provider invoices).

**Out of scope for Phase 2:** auto-migration engine, additional engines
beyond Postgres (Redis arrives later), team workspaces.

---

## 6. Phase 3 — The engine (the actual product moat)

**Theme:** the part that makes nlqdb structurally different — the
Workload Analyzer + Migration Orchestrator + multi-engine routing
described in [`PLAN.md` §2](./PLAN.md).

**Scope:**

- Query Log → Workload Analyzer → Migration Orchestrator pipeline per
  [`PLAN.md` §2.1–§2.2](./PLAN.md).
- Add **Redis (Upstash)** as the second engine. Build the PG↔Redis
  shadow-write + dual-read verifier + atomic cutover.
- Add **DuckDB** as the third engine for analytics workloads.
- **Pro tier** live (usage-based, $25/mo minimum) per
  [`DESIGN.md` §6](./DESIGN.md).
- **Self-hosted classifier** on a single A10G via Modal once we cross
  ~50k queries/day, per [`DESIGN.md` §8](./DESIGN.md) cost-control rule
  #5.
- **Continuous backups** to R2 with point-in-time restore (7d free, 30d
  Hobby+).
- **Team workspaces** with the minimal Owner/Member/Public role model
  from [`DESIGN.md` §4.2](./DESIGN.md).

**Exit gate** (matches [`PLAN.md` §2.5](./PLAN.md)):

- ≥100 successful auto-migrations in production with zero user-visible
  downtime.
- Workload Analyzer beats a hand-tuned baseline on a held-out benchmark
  we author.
- Verified weekly restore drill passes.
- 50 paying customers across Hobby + Pro.

---

## 7. Phase 4+ — Beyond the v1 thesis

Out of scope for this implementation plan — covered in
[`PLAN.md` §8](./PLAN.md) and [`DESIGN.md` §10–§12](./DESIGN.md). Includes:
"bring your own Postgres" (P4 unblock), enterprise (SSO, audit log,
on-prem), additional engines (pgvector at scale, ClickHouse,
TimescaleDB, Typesense), `<nlq-stream>` for changefeeds.

---

## 8. Cross-phase concerns (always-on, never "done")

These are not phases — they run continuously.

- **Build-in-public cadence** per [`DESIGN.md` §5.3](./DESIGN.md): one
  long-form post / week, three threads / week, one release / week.
- **Security hygiene**: Trivy + CodeQL on every PR (already in §13 CI),
  secret rotation quarterly, dependency upgrades monthly via Dependabot.
- **Inference cost monitoring**: a weekly Grafana board showing $/query
  by tier, free-tier headroom, cache hit rate. If any free-tier provider
  exceeds 70% of its daily quota for 3 days running, we light up its
  paid tier *and* file a ticket to investigate why.
- **Free-tier abuse mitigation** ([`PLAN.md` §7](./PLAN.md)): per-IP +
  per-account rate limits from Day 1; PoW on signup if needed; anomaly
  detection in Phase 2.
- **Provider-swap drill**: once per quarter, force a failover from the
  primary LLM provider to the second in the chain in production for one
  hour. If anything breaks, the `llm/` adapter has a bug.
- **Backup-restore drill**: weekly automated test that restores a sample
  DB to a fresh instance and diffs the rows. Failures page on-call.

---

## 9. What we are explicitly **not** doing in any phase above

Re-stating the non-goals from [`DESIGN.md` §12](./DESIGN.md) so they
don't sneak into a sprint:

- No visual schema editor.
- No query builder.
- No migrations tool (schemas only widen).
- No mobile app.
- No GraphQL API.
- No "Sign in with nlqdb" identity-provider product.
- No on-prem version before Phase 4.
- No paid ads, ever, before product-market fit.

If a stakeholder asks for any of these, the answer is "after Phase 3
exit gate, we'll re-evaluate." Not "yes, but later." Not "soon."

---

*Living document. Update via PR alongside the change being shipped.
Phases are not calendar windows — they are dependency-ordered
acceptance gates.*
