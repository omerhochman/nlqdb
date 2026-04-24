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

- [ ] `nlqdb.com` on Cloudflare DNS.
- [ ] `nlqdb.ai` on Cloudflare DNS; apex 301 → `nlqdb.com` (§2.1 design).

### 2.2 Identity / source / distribution

- [ ] GitHub org `nlqdb` — branch protection, required reviews, secret
      scanning, Dependabot.
- [ ] npm org `nlqdb` (reserves `@nlqdb/*`).
- [ ] `nlqdb/homebrew-tap` (GitHub repo).
- [ ] Docker Hub org `nlqdb` (optional self-host image).

### 2.3 Hosting / runtime (§7 design)

- [ ] **Cloudflare** — Pages, Workers, KV, D1, R2, Queues, Workers AI,
      Durable Objects. Capture `CLOUDFLARE_ACCOUNT_ID`,
      `CLOUDFLARE_API_TOKEN` (scoped), `CF_AI_TOKEN`.
- [ ] **Neon** — `NEON_API_KEY`.
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
- [ ] **GitHub OAuth app** → `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
      Redirect URIs: `app.nlqdb.com/auth/callback/github`,
      `nlqdb.com/device/approve` (device-code flow).
- [ ] **Google OAuth client** → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
      (same redirect set).
- [ ] CLI build dep: `github.com/zalando/go-keyring` (OS keychain).
- [ ] **Resend** → `RESEND_API_KEY`; configure SPF/DKIM/DMARC for `nlqdb.com`.
- [ ] **AWS SES** (fallback) → `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- [ ] **Stripe** (test mode until Phase 2) → `STRIPE_SECRET_KEY`,
      `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`; enable Stripe Tax.

### 2.6 Observability

- [ ] Sentry → `SENTRY_DSN` (5k errors/mo free).
- [ ] Plausible — self-hosted on Fly (no SaaS key).
- [ ] Grafana Cloud → `GRAFANA_CLOUD_API_KEY`, `GRAFANA_OTLP_ENDPOINT`.

### 2.7 Secret management

Store all above in **GitHub Actions secrets** (org + repo) and
**Cloudflare Workers secrets** (runtime). Local dev via `direnv` +
per-dev `.envrc` (gitignored). Every repo has one `.env.example` listing
variable names — no values, ever.

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
