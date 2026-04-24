# nlqdb — High-Level System Design

> One-line vision: **a database you talk to, with a backend that doesn't exist.**
> You write HTML. Each component asks for what it wants in plain English. nlqdb answers.

This document is the high-level design. Phasing, deeper rationale and risks live in
[`PLAN.md`](./PLAN.md). User research lives in [`PERSONAS.md`](./PERSONAS.md). The competitive
landscape lives in [`COMPETITORS.md`](./COMPETITORS.md). This doc focuses on **what we build,
how the parts fit together, what tools we use, and how we ship it for $0/month**.

---

## 0. Core values (non-negotiable)

Acceptance criteria for every PR. If a change violates one, it doesn't ship.

- **Free.** Sign up, build, ship to production without a credit card. Forever.
- **Open source.** Core engine, CLI, MCP, SDKs — Apache-2.0. Cloud is a
  convenience, not a moat.
- **Simple.** One way to do each thing. Two endpoints, two CLI verbs, one
  chat box. No config files in the first 60 seconds. No "pick a region". No
  schema. `fetch` is the SDK. Every error is one sentence with the next
  action. If a feature needs a tutorial, it failed. If two engineers
  disagree on a design, ship the simpler one.
- **Effortless UX.** Zero modals. Zero "are you sure" except for destructive
  actions. Keyboard-first. The chat is the product; everything else is a
  disclosure.
- **Seamless auth — one identity, four surfaces, zero friction.** Auth is a
  feature, not a gate:
  - **No login wall before first value.** Every surface produces a working
    answer before asking who you are. Anonymous-mode is the default (§4.1).
  - **One sign-in covers everything.** One Better Auth identity across web,
    CLI, and every MCP host. Signing in once signs you in everywhere on
    that device.
  - **Tokens refresh silently.** Users never see a 401 or "session expired";
    access tokens (1h) refresh in the background from a keychain-stored
    refresh token; failed refresh auto-reopens the browser flow and
    resumes the original command.
  - **MCP install is one command, no arg.** `nlq mcp install` auto-detects
    installed hosts, signs in if needed, provisions a host-scoped key per
    host, patches each config. Explicit `<host>` is a power-user override.
  - **Credentials live in the OS keychain.** Never in plaintext files.
    `NLQDB_API_KEY` is the CI escape hatch, not the default.
  - **Revocation is instant and visible.** Every token on every device is
    listed with last-used; revoke is one click; the affected surface
    re-prompts seamlessly.
- **Creative.** The product looks and feels nothing like a Tailwind template.
  Personality is required. See §3.1.
- **Fast.** p50 query < 400ms (cache hit), p95 < 1.5s (cache miss), cold
  start < 800ms. Marketing site: Lighthouse 100/100/100/100, first paint
  < 600ms on 4G. CLI: binary < 8MB, starts in < 30ms, first byte < 200ms
  on cache hit.
- **Goal-first, not DB-first.** No persona ever woke up wanting to "create
  a database" — they want a meal-planner, an agent that remembers, a
  number for the 4pm sync. The DB is plumbing. See §0.1.
- **Bullet-proof by design, not by handling.** Make bad states unreachable
  by constraining inputs, not branching on them:
  - Schemas only widen — no "schema mismatch" branch.
  - Every mutating call takes an `Idempotency-Key` — retries safe by construction.
  - Plans content-addressed by `(schema_hash, query_hash)` — no cache invalidation.
  - All writes go through the validated planner; raw writes don't exist on the hot path.
  - Destructive ops require a diff preview + second confirm — no "accidental delete" branch.
  - Numeric inputs are rationals or bounded ints — no `NaN`, no overflow.
  - Secrets scoped per-DB — no "wrong tenant" branch.

---

## 0.1 On-ramp inversion (the most important design principle)

No persona's goal is "create a database" (see [`PERSONAS.md`](./PERSONAS.md)).
The DB is a side effect of the thing they're trying to do. Every surface is
reframed so the user's first action is stating a goal; the DB materializes
as a consequence.

| Surface | Old (DB-first) | New (goal-first) |
|---|---|---|
| Marketing hero | "Name your database" | "What are you building?" |
| Platform first run | "Create database" button | Single chat input, DB created silently |
| CLI first command | `nlq db create orders` | `nlq new "an orders tracker"` |
| MCP first call | `nlqdb_create_database("memory")` | `nlqdb_query("memory", "remember…")` (DB auto-created) |
| `<nlq-data>` | `db="orders"` required | `goal="…"` leads; `db` inferred |
| HTTP API | 2 endpoints | `POST /v1/ask { "goal": "…" }` returns session + DB |

**Mechanism:** every entry point accepts a goal. The first call materializes
a DB (slug + short hash), persists it under the caller's identity (or
anonymous token), and returns a session containing the DB handle. The DB is
always one flag away for power users — goal-first is the default, not the
only way.

---

## 1. The vision in one paragraph

A developer writes plain HTML. They drop in a `<nlq-data>` element with a one-line
English prompt: *"the 5 most-loved coffee shops in Berlin, with photos."* The element
hits the nlqdb API, which (a) figures out which of the user's databases to query,
(b) plans the query against the right engine, (c) executes it, (d) returns rows + a
rendered HTML fragment + a typed JSON payload. The developer wrote zero backend code.
There is no schema, no ORM, no migrations, no SQL, no `DATABASE_URL`. nlqdb is
**both the database and the backend**, addressed in natural language.

The four surfaces (Web, API, CLI, MCP) are four projections of the same engine.
The marketing site is the fifth surface — a self-aware, content-rich landing built
the same way the user's own apps will be built.

---

## 2. System architecture (high level)

```
                                    ┌──────────────────────────────────────┐
                                    │          nlqdb Core Engine           │
                                    │                                      │
   ┌──────────────┐    HTTPS        │   ┌────────────────────────────┐    │
   │ Marketing    │ ─────────────►  │   │  Edge Router (Cloudflare    │    │
   │ Site         │                 │   │  Workers, < 50ms global)    │    │
   │ (Astro)      │                 │   └──────────────┬─────────────┘    │
   └──────────────┘                 │                  │                  │
                                    │                  ▼                  │
   ┌──────────────┐                 │   ┌────────────────────────────┐    │
   │ Platform     │ ───── HTTPS ──► │   │  Auth & Quota (Better Auth │    │
   │ Web App      │                 │   │  + Workers KV)              │    │
   │ (Astro+      │                 │   └──────────────┬─────────────┘    │
   │  React       │                 │                  │                  │
   │  islands)    │                 │                  ▼                  │
   └──────────────┘                 │   ┌────────────────────────────┐    │
                                    │   │  Plan Cache (KV, content-  │    │
   ┌──────────────┐                 │   │  addressed by schema_hash) │    │
   │ CLI (`nlq`)  │ ─── HTTPS ───►  │   └──────┬──────────────┬──────┘    │
   │ Go binary    │                 │          │ HIT          │ MISS      │
   └──────────────┘                 │          ▼              ▼           │
                                    │   ┌──────────┐   ┌──────────────┐  │
   ┌──────────────┐                 │   │ Executor │   │ NL→Plan      │  │
   │ MCP Server   │ ─── HTTPS ───►  │   │ (Engine  │   │ Compiler     │  │
   │ (TypeScript) │                 │   │ adapter) │◄──┤ (LLM router) │  │
   └──────────────┘                 │   └────┬─────┘   └──────────────┘  │
                                    │        │                           │
   ┌──────────────┐                 │        ▼                           │
   │ <nlq-data>   │ ─── HTTPS ───►  │   ┌────────────────────────────┐  │
   │ HTML element │                 │   │ Engines: Postgres │ Redis │ │  │
   │ (any site)   │                 │   │ DuckDB │ pgvector │ ...    │  │
   └──────────────┘                 │   └────────────────────────────┘  │
                                    │                  │                 │
                                    │                  ▼                 │
                                    │   ┌────────────────────────────┐  │
                                    │   │ Query Log → Workload       │  │
                                    │   │ Analyzer → Migration       │  │
                                    │   │ Orchestrator (background)  │  │
                                    │   └────────────────────────────┘  │
                                    └──────────────────────────────────────┘
```

Five surfaces, one edge router, one core engine. No parallel implementations.

### 2.1 Domains

Canonical: **`nlqdb.com`** (`.ai` is held defensively and 301s to `.com`).

| Hostname | Purpose |
|---|---|
| `nlqdb.com` | Marketing site (§3.1). Primary entry + SEO. |
| `app.nlqdb.com` | Authenticated platform (§3.2). |
| `api.nlqdb.com` | HTTP API + MCP transport. Versioned `/v1/…`. |
| `elements.nlqdb.com` | `<nlq-data>` JS CDN (§3.5). R2 + Cloudflare. |
| `docs.nlqdb.com` | Documentation. |
| `chat.nlqdb.ai` | Optional vanity shortcut → `app.nlqdb.com/chat`. |

`.com` is canonical (universally typeable, cheap renewal, no registry
risk). `.ai` is held to block squatters. `@nlqdb` is secured on GitHub,
npm, X, LinkedIn, Discord, Bluesky. Total fixed cost: ~$85/yr (the only
unavoidable recurring cost; see §7).

---

## 3. Surfaces

### 3.1 Marketing site — `nlqdb.com`

Static-first **Astro** (0KB JS by default; islands where needed). Hosted on
Cloudflare Pages. Lighthouse 100/100/100/100.

**Pages:** `/` (the hero goal-first input), `/docs`, `/pricing` (§6),
`/manifesto` (§0 humanized), `/blog`, `/showcase`.

**Hero:** one input — *"What are you building?"* — cycling placeholders from
real persona goals. Enter morphs the page into chat (View Transitions), DB
created silently, no signup wall.

**Creative direction** (anti-template): neo-brutalist + terminal — thick
borders, hard shadows, JetBrains Mono headlines, one accent (Acid Lime
`#C6F432` on near-black `#0B0F0A`). Live query ticker at the top (real,
anonymized). Scroll-driven story where a DB builds itself alongside the
copy. Kinetic typography on "talk". Real-time GitHub star count. No stock
photos. No cookie banner (Plausible, self-hosted).

**AEO/GEO:** Definition-lead sentence on every page; `FAQPage` / `HowTo` /
`SoftwareApplication` / `Article` JSON-LD; direct-answer block in first
150 words; `llms.txt`; sitemap + AI-crawler-permissive `robots.txt`;
transcripts on every video. Goal: citations from Perplexity / ChatGPT /
Gemini / Claude.

### 3.2 Platform web app — `app.nlqdb.com`

Signed-in surface. Same Astro project, React islands for chat + dashboard.

- **Chat** — three-part response (answer / data / trace), streaming,
  in-place edit + re-run, Cmd+K palette (see [`PLAN.md` §1.2](./PLAN.md)).
- **Database list** (left rail) — engine, size, last query per DB.
- **Settings** — API keys, team (Phase 1.5), billing, live $-counter.
- **Embed snippets** — copy-paste `<nlq-data>` HTML with `pk_live_`
  pre-inlined (§14.5).
- **Escape hatch** — "Show connection string" reveals the raw Postgres URL.

**Component model**: Astro routes + React islands. State is URL-first
(every chat is permalinkable) + a small Zustand store. No global Redux.

### 3.3 CLI — `nlq`

Single static Go binary (`nlq`, 3 chars, no PATH collision). npm scope
`@nlqdb/*` owned; binary name `nlq` and npm name `nlqdb` are taken so we
don't publish under either.

**Install:** `curl -fsSL https://nlqdb.com/install | sh` → `~/.local/bin/nlq`.
Also: `brew install nlqdb/tap/nlq`, `npm i -g @nlqdb/cli` (Node shim).

**Conventions** (per `gh` / `fly` / `wrangler`): subcommand-first
(`nlq <noun> <verb>`), human output by default with `--json` for scripts,
never TTY-detect. Preferences in `~/.config/nlqdb/config.toml` (non-secret only).

**Default surface:**

```
nlq                          # interactive prompt → creates DB silently, drops into REPL
nlq new "an orders tracker"  # one-liner: creates DB from goal, opens chat
nlq "how many signups today" # bare query against the current DB
nlq login                    # device-code flow (browser); see auth below
nlq mcp install              # auto-detects MCP host(s) and sets them up (§3.4)
```

**Power-user surface:** `nlq db create|list`, `nlq query <db> "…"`,
`nlq chat <db>`, `nlq use <db>`, `nlq connection <db>` (raw Postgres URL).

**Auth flow** (per §0; full spec §4.3):

1. **Anonymous-first.** Bare queries work with no sign-in. The CLI mints
   an anonymous token (72h window, §4.1) into the OS keychain.
2. **`nlq login`** uses OAuth 2.0 Device Authorization Grant. The browser
   lands on `verification_uri_complete` with the code pre-filled in the
   URL — one "Approve this device?" click, no typing. Raw code is printed
   as a fallback for SSH / headless. On approval: anonymous DBs adopted
   (§4.1); refresh token (90d) to OS keychain; access token (1h, JWT)
   held in memory.
3. **Silent refresh.** 401 → refresh → retry, once. If refresh fails,
   CLI re-runs the device flow in-place and resumes the command.
4. **`nlq logout`** wipes the keychain entry. `nlq whoami` prints identity
   + device + last-used.
5. **CI mode.** `NLQDB_API_KEY` takes precedence; `nlq login` is skipped
   and no keychain access is attempted. Only env-var auth path.
6. **Storage** is always the OS keychain (`zalando/go-keyring`: Keychain /
   Credential Manager / libsecret). Fallback: AES-GCM file at
   `~/.config/nlqdb/credentials.enc` keyed to the machine, with a warning.
   Plaintext is never an option.

### 3.4 MCP server — `@nlqdb/mcp`

Thin adapter over the HTTP API (same code path; never talks to Postgres,
never holds a DB credential). Distributed via `npx -y @nlqdb/mcp`.

**Tools:** `nlqdb_query(db, q)` (creates DB on first reference per §0.1;
no public `nlqdb_create_database` tool), `nlqdb_list_databases()`,
`nlqdb_describe(db)`.

**Install paths** (per §0 "Seamless auth"; full spec §4.3, §4.4):

1. **`nlq mcp install`** *(default, no arg).* Scans known host configs for
   Claude Desktop, Cursor, Zed, Windsurf, VS Code, Continue; prints what
   was found (transparency — we never touch unnamed files). One host →
   silent install. Multiple → numbered prompt (or `--all`). None → prints
   install links. If the user isn't signed in, runs the device-code flow
   first. Mints `sk_mcp_<host>_<device>_…` via `POST /v1/keys`; writes it
   straight to the host's config file (never displayed). Hot-reloaders
   (Cursor/Zed/Windsurf) pick up the change in seconds; Claude Desktop
   gets a restart prompt. Self-check via `nlqdb_list_databases()` confirms.
2. **`nlq mcp install <host>`** *(explicit override).* Same flow; targets
   the named host even if not installed. `<host>` ∈ {`claude`, `cursor`,
   `zed`, `windsurf`, `vscode`, `continue`}.
3. **Website one-click** (`app.nlqdb.com/mcp`) mints the key server-side
   and opens an `nlqdb://install?…` deep link the CLI handles.
4. **`NLQDB_API_KEY`** env var — CI / Docker / air-gapped escape hatch;
   takes precedence over any config file. Key generated in the dashboard.

**Per-host isolation** (agents do **not** share credentials):

- Each `sk_mcp_<host>_<device>_…` key carries `{ user_id, mcp_host,
  device_id, created_at, last_used_at }`. Dashboard lists each with its
  host, device, and last-used.
- DBs created via MCP are tagged with `(mcp_host, device_id)` and default
  to visible only under that tuple; promote-to-account is one click.
- Revocation is instant. The next tool call returns `401 key_revoked`;
  the server surfaces *"Sign in again: run `nlq mcp install`."* to the
  host LLM. Re-install auto-detects the original host.

**Transport:** MCP over stdio to the host process only. No network
listener on the user's machine. Downstream the server sends its scoped
key to `api.nlqdb.com`; Postgres credentials never leave Cloudflare (§4.4).

### 3.5 The embeddable HTML element — `<nlq-data>`

**This is the bet.** A web component (custom element) that any developer can drop
into static HTML. Distributed as `@nlqdb/elements` (one CDN URL: `https://elements.nlqdb.com/v1.js`).

```html
<script src="https://elements.nlqdb.com/v1.js" type="module"></script>

<!-- Goal-first form (default; per §0.1). DB is auto-created from the goal
     on the first call and remembered server-side per api-key. -->
<nlq-data
  goal="the 5 most-loved coffee shops in Berlin, with photos"
  api-key="pk_live_..."
  template="card-grid"
  refresh="60s"
></nlq-data>

<!-- Power-user form (explicit DB; same element, opt-in). -->
<nlq-data
  db="coffee-shops"
  query="the 5 most-loved coffee shops in Berlin, with photos"
  api-key="pk_live_..."
  template="card-grid"
></nlq-data>
```

**How it works:** element POSTs `{ q, render: "html" }` → API returns
`{ answer, data, html, trace }` with `html` rendered from a safe template
registry (`card-grid`, `table`, `list`, `kv`, `chart`, `raw`). Element
morphs the DOM via View Transitions. `refresh="60s"` is a timer; SSE
auto-upgrades when supported.

**Bullet-proof** (§0): templates make XSS structurally impossible (LLM
never returns raw HTML to the browser); `pk_live_` is read-only,
origin-pinned, rate-limited; writes require `<nlq-action>` with a signed
write-token. Element ships < 6KB gzipped, zero dependencies.

---

## 4. Authentication & identity

### 4.1 Library and methods

**Better Auth** (MIT, TypeScript, framework-agnostic) on Cloudflare Workers
+ D1. No per-MAU fees, no vendor lock on user data shape. The Auth.js team
merged into Better Auth in 2025; it's the de-facto TS standard. We build
the UI ourselves — the sign-in page is part of the brand.

Methods at launch: **magic link** (primary), **passkey** (promoted on
second visit), **GitHub OAuth**, **Google OAuth**. No passwords, ever.

**Anonymous mode:** an opaque `localStorage` token lets users create and
query a DB before signing in; the DB lives 72h tied to the token. On
sign-in the DB is adopted by updating one row. No conditional code paths.

**Session storage:** JWT-signed access tokens (1h); KV holds the
revocation set. Workers KV free tier (100k reads/day) is ample.

**API keys** are separate from sessions. Three types:

| Type | Scope | Used by |
|---|---|---|
| `pk_live_…` | Publishable, **read-only**, per-DB, origin-pinned | `<nlq-data>` |
| `sk_live_…` | Secret, server-only, full scope | Backend / HTTP API |
| `sk_mcp_<host>_<device>_…` | Like `sk_live_` + `(mcp_host, device_id)` claims | MCP server (§3.4) |

Keys hashed with Argon2id. Last 4 chars stored cleartext for display
(*"sk_live_…a4f7 · 3m ago · Cursor on macbook-air"*). No plaintext
retrieval path — if lost, rotate.

### 4.2 Authorization model

Phase 1 has three roles: **Owner** (full), **Member** (read + query,
no destructive ops or key creation), **Public** (anonymous, read-only via
publishable key, rate-limited). RBAC comes in Phase 2 only if a paying
customer asks twice.

### 4.3 Session lifecycle across surfaces

| Surface | Initial auth | Store | Access TTL | Refresh |
|---|---|---|---|---|
| Web | Magic link / passkey / GitHub / Google | `__Host-session` HttpOnly cookie | 1h | 30d sliding refresh in KV |
| CLI | Device-code (`nlq login`) | OS keychain (refresh) + memory (access) | 1h | 90d, rotated on every use |
| MCP | `nlq mcp install` (auto-detect) | Host config file (key only) | n/a | Key rotation, not refresh |
| Embed | `pk_live_` | Inline in HTML | n/a | Key rotation |

**Device-code flow:** CLI POSTs `/v1/auth/device`, gets
`verification_uri_complete` (code embedded in the URL) + `user_code`
fallback. Browser opens straight to "Approve this device?" — one click, no
typing. On approval, CLI polls `/v1/auth/device/token`, gets
`{access_token, refresh_token, expires_in: 3600}`, writes refresh token
to keychain.

**Refresh:** 401 on any call → `POST /v1/auth/refresh` → retry once. On
refresh failure the surface re-initiates the original flow in-place
(web: `/sign-in?return_to=…`; CLI: re-runs device flow and resumes the
command). Users never see a bare 401.

**Revocation:** write to the KV revocation set, keyed by `jti` (sessions)
or key-hash-prefix (API keys). Edge checks membership on every request;
≤2ms on miss, free on hit.

### 4.4 Service-to-service auth

```
[web | CLI | MCP client] ──► api.nlqdb.com (Workers edge)
                                      │
                                      │ signed internal JWT (30s, user_id + db_scope)
                                      ▼
                       [Connection Pool | Plan Cache | LLM]
                                      │
                                      ▼
                       [Neon Postgres | Upstash Redis | …]
```

- **The edge is the only component that sees external credentials.** It
  terminates the bearer header and signs a short-lived (30s) internal JWT
  for all downstream calls using a Workers-only secret.
- **Downstream components verify the internal JWT.** A leaked external
  key has the blast radius of the key's scope — never the whole system.
- **MCP server holds no DB credentials.** It signs its outbound call with
  its `sk_mcp_…` key; `@nlqdb/mcp` has zero DB-driver deps in its
  lockfile and CI refuses any addition.
- **Postgres pool is at the edge, keyed by tenant.** Internal JWT binds
  the caller via `SET LOCAL search_path` + Neon role scoping; no branch
  can pick the wrong tenant (§9).
- **Embed uses `pk_live_` only.** Origin-pinned, read-only; edge rejects
  any mutating call with a publishable key before the plan runs. Writes
  use `<nlq-action>` with a signed short-lived write-token (Phase 2).

### 4.5 Rotation, revocation, device management

Per §0 "Seamless auth" — instant and visible:

- **Dashboard → Keys** lists every credential (`pk_live_`, `sk_live_`,
  every `sk_mcp_`) + every web session + every CLI device. Columns: type,
  host, device, created, last-used, coarse IP, user label.
- **Revoke** is one click, propagates in ≤2s. Affected surface gets
  `401 key_revoked` and enters the seamless re-auth path (§4.3).
- **Rotate** (`sk_live_` / `sk_mcp_`) issues a new key, deprecates the
  old one with 60d grace, emits a webhook. `nlq keys rotate <id>` CLI.
- **Global sign-out** invalidates all sessions, device refresh tokens,
  and `sk_mcp_` keys. `sk_live_` / `pk_live_` are left alone (production
  credentials; rotate separately).
- **Email + in-app notification** on key create/rotate/revoke and
  new-device sign-in (templates in §5.1).
- **No plaintext retrieval.** Lost a key → rotate. Refusing to ship a
  "reveal" button is the feature.

---

## 5. Email, content & marketing

### 5.1 Transactional email — Resend (3k/mo free)

Templates in **React Email**, one plain-text fallback per message, no
marketing content. Triggers: magic links, billing alerts (80% quota),
security alerts per §4.5 (new-device, new MCP host, key create/rotate/
revoke, global sign-out), DB-paused notification. Fallback: AWS SES
(~$0.10/1k) via the same templates — swap with one env var.

### 5.2 Marketing email — Listmonk (self-hosted, SES)

Opt-in newsletter, launch announcements, weekly build-in-public digest.
Plausible for click-through. No third-party tracking pixels.

### 5.3 Content strategy

Community-led, docs-first. Channels in priority order: **GitHub** (the
repo is the landing page), **docs** (SEO+AEO optimized), **build-in-public
on X/LinkedIn** (real metrics, real failures, weekly), **Hacker News**
(Show HN for major launches), **Product Hunt** (visual launches),
**Reddit** (`r/webdev`, `r/programming`, `r/ClaudeAI`, `r/LocalLLaMA`,
`r/htmx`, `r/databases`), **Discord** (single server, three channels),
**video** (short demos, transcripts feed AEO), **conferences**
(founder-speaks, year 1).

**Cadence:** 1 long-form blog / week, 3 build-in-public threads / week,
1 release / week, 1 community spotlight / month.

**Refuse:** cold outbound email, paid ads pre-PMF, influencer
partnerships pre-PMF, AppSumo lifetime deals, gated content.

### 5.4 Analytics

**Plausible** (self-hosted on Fly, GDPR-exempt, no cookie banner),
**Sentry** (5k errors/mo free), **OpenTelemetry** → **Grafana Cloud**
free for traces. PostHog only if Plausible isn't enough (likely Phase 2).

---

## 6. Pricing — freemium done honestly

The constraint: **a real user must be able to ship a real product without
paying us.** Aligned with [`PLAN.md` §5](./PLAN.md).

| Tier | Price | What you get | Limits | Card |
|---|---|---|---|---|
| **Free** | $0 forever | Unlimited DBs, full chat/CLI/MCP/embed, all templates, 7-day backups | 1k queries/mo, 500MB/DB, pause after 7d idle (resume <2s), 100 emails/day | **No** |
| **Hobby** | $10/mo | Free + no pausing, 30-day backups, email support, custom domain on embeds, 5 team members | 50k queries/mo, 5GB/DB, 5k emails/day | Yes |
| **Pro** | $25/mo min, usage | Hobby + dedicated compute, 30-day PITR, priority Slack, Google Workspace SSO | $0.0005/query over 50k, $0.10/GB-mo over 5GB; user-set hard cap | Yes |
| **Enterprise** | Custom | VPC peering, SAML SSO, audit-log export, custom SLA, on-prem option | Negotiated | Annual |

**Free-tier guarantees:** no card, ever. Hitting a limit rate-limits — never
deletes, never silently upgrades. Export is always free, even 90d after
cancellation. DBs auto-pause after 7d idle (clearly disclosed), resume in <2s.

**Honest billing:** first charge double-confirmed via email; soft cap at
80% (email warning); hard cap default 100% (one-click extension);
cancellation is one click, no call, no exit survey.

**Stack:** Stripe Billing + Stripe Tax; **Lago** (self-hosted on Fly) for
usage metering with sub-ms hot-path overhead, batched into Stripe.

---

## 7. The $0/month launch stack

Line-by-line accounting of how we ship to production for $0/month until we
have paying customers.

| Concern | Tool | Free tier (Apr 2026) |
|---|---|---|
| Zone (DNS, CDN, SSL, L7 DDoS, WAF) | Cloudflare **Free plan**, per zone | Unmetered DNS + CDN + DDoS; 5 custom rules, 5 WAF rules, 70 page rules; common-bot challenge only. Upgrade triggers in IMPLEMENTATION §2.1. |
| Marketing site | Cloudflare Pages | Unlimited requests, 500 builds/mo |
| Edge compute | Cloudflare Workers | 100k req/day, 10ms CPU/req |
| Session / plan cache | Cloudflare KV | 100k reads/day, 1k writes/day |
| Control plane DB | Cloudflare D1 | 5M reads/day, 100k writes/day, 5GB |
| User DBs (Postgres) | Neon | 0.5GB, scale-to-zero |
| User DBs (Redis) | Upstash | 10k cmds/day, 256MB |
| Object storage | Cloudflare R2 | 10GB, 1M Class A ops/mo, **zero egress** |
| Inbound email (forwarding) | Cloudflare Email Routing | Unlimited volume, 200 rules/zone (Free plan feature) |
| Transactional email | Resend | 3k/mo, 100/day |
| Marketing email | Listmonk (self-hosted) → SES | Unlimited send via SES |
| Email fallback | AWS SES | 62k/mo free from EC2 |
| Auth | Better Auth (OSS) | Free, no MAU fees |
| Payments | Stripe | 0% until first charge; 2.9%+30¢ after |
| Usage metering | Lago (self-hosted) | OSS, free |
| App errors | Sentry | 5k errors/mo |
| Web analytics | Plausible (self-hosted) | OSS, GDPR-exempt |
| Backend traces | Grafana Cloud | 10k metrics, 50GB logs |
| Long-running compute | Fly.io | 3 small machines, 3GB volumes |
| Domains | `nlqdb.com` + `nlqdb.ai` | **~$85/yr — only fixed cost** |
| LLM inference | See §8.1 (strict-$0 path) | — |
| Code + CI | GitHub | Free for OSS, 2k Action min |
| MCP / CLI distribution | npm, GH Releases, Homebrew | Free |

**Total at zero users:** $0 + ~$7/mo for the domain. At ~1k users /
~10k queries/day: still $0 once credits land; ~$30–60/mo otherwise
(mostly LLM tokens; mitigated by the plan cache).

**Single-vendor caveat:** concentrating on Cloudflare for the hot path
buys zero egress, one network, most-generous free tier. We mitigate with
a per-service adapter layer — if we need to leave Cloudflare, it's a week.

---

## 8. AI model selection

Tiered routing — never send all traffic to a frontier model. Pricing
approximate, April 2026.

| Job | Tier | Model | $/1M in/out |
|---|---|---|---|
| Hot-path classification (read/write/destructive) | 1 | GPT-5.4 Nano / Gemini 3.1 Flash-Lite | $0.20 / $0.50 |
| Schema embedding | 1 | Gemini 3.1 Embeddings / bge-m3 self-host | ~$0.02/1M |
| NL → query plan (workhorse, ~80% of cost) | 2 | Claude Sonnet 4.6 | $3 / $15 |
| Hard plans / multi-engine reasoning (≤5%) | 3 | Claude Opus 4.7 | $5 / $25 |
| Result summarization (rows → prose) | 1 | GPT-5.4 Nano / DeepSeek V3.2 | $0.20 / $0.50 |
| MCP tool-use loop | — | Caller's model — we don't pay | — |
| Workload analyzer (batch) | 3 | Opus 4.7 / Gemini 3.1 Pro | $5 / $25 |

**Internal dev** (the team, not the runtime): Opus 4.7 for design docs /
day-to-day code / marketing copy; Sonnet 4.6 for quick refactors;
GPT-5.4 or Gemini 3.1 Pro for second-opinion review; DeepSeek V3.2 for
fixtures; Gemini 3.1 Pro for SEO/AEO; Imagen 4 / Flux 1.5 Pro for
images (we mostly avoid — see §3.1).

**Cost-control rules:**
1. Plan cache first, LLM second — 60–80% cache hit on mature workloads.
2. Smallest model that solves the task wins; confidence-based escalation.
3. Prompt caching on every provider that supports it (~80% input reduction).
4. No summarization when client sends `Accept: application/json`.
5. Self-host classifier once we hit ~50k queries/day (single A10G on
   Modal, quantized 8B, ~$200/mo flat).

### 8.1 Strict-$0 inference path (Day 1, no credits, no card)

Credits take weeks; §0 says we ship without spending money. The 2026
free-tier landscape makes this viable at launch scale.

| Job | Provider | Free limit | Card |
|---|---|---|---|
| Hot-path classification | Groq — Llama 3.1 8B Instant | 14,400 RPD / 500k TPD | No |
| NL → query plan | Google AI Studio — Gemini 2.5 Flash | 500 RPD / 250k TPM | No |
| Hard-plan fallback | Google AI Studio — Gemini 2.5 Pro | 100 RPD | No |
| Summarization | Groq — Llama 3.3 70B / Qwen3 32B | 1,000 RPD | No |
| Embeddings | Cloudflare Workers AI — bge-base-en-v1.5 | 10,000 Neurons/day | No |
| Universal fallback | OpenRouter — `:free` models | ~200 RPD | No |
| Local dev | Ollama (Llama 3.2 3B / Qwen 2.5 7B) | Unlimited locally | No |

**Capacity:** ~500 plan generations/day + ~14,400 classifications/day →
~2–4k user queries/day after the plan cache. Covers Phase 1's exit
criteria with headroom.

**Architecture rule:** every LLM call routes through one `llm/` adapter
taking `tier` ∈ `{classify, plan, summarize, hard, embed}` and a
cost-ordered provider chain. Day-1 `plan` chain:
`[gemini_flash_free, groq_llama70b_free, openrouter_free, anthropic_paid]`.
Swap order via env var. Zero app code changes per §9.

**Constraints we accept:**
- **Data privacy.** Free tiers may use inputs to train; disclosed in our
  privacy policy. **Pro customers route only through paid / retention-off
  providers** — the one meaningful free→paid capability upgrade.
- **RPM ceilings.** Bursts queue briefly; "queued — 2s" surfaced in UI.
- **Provider outages.** The chain auto-falls-through, sub-100ms switch.
- **Geo.** Groq is US-only; Gemini + Workers AI are global. Classification
  has Workers AI Llama 3 as a non-US backup to keep first-byte < 1s.

**Account checklist** (mirrored in [`IMPLEMENTATION.md`](./IMPLEMENTATION.md)):
Google AI Studio → `GEMINI_API_KEY`; Groq → `GROQ_API_KEY`; Cloudflare
Workers AI → `CF_AI_TOKEN`; OpenRouter → `OPENROUTER_API_KEY` (fallback).

**Total cost to add intelligence Day 1: $0.**

---

## 9. Bullet-proof-by-design checklist

We make bad states unreachable, not caught.

| Edge case | How it's unreachable |
|---|---|
| Schema mismatch | Schemas only widen. `ALTER TABLE ADD COLUMN … NULL`. |
| Cache invalidation | Plan cache keyed by `(schema_hash, query_hash)`. Old keys LRU. |
| Signup race | Idempotent on email. Second signup = sign-in. |
| Double-charge | `Idempotency-Key` required on mutations; Stripe webhooks deduped. |
| Wrong-tenant leak | Enforced at the connection pool, not app code. No branch to take. |
| SQL injection | No SQL strings; planner emits typed plan, executor binds. |
| Cold-start timeout | Workers cold-start <5ms; Neon resume <1s; 2s first-byte ceiling. |
| LLM column hallucination | Post-plan schema validation; re-prompt with the error. |
| Accidental mass delete | Destructive plans show a diff, require second Enter. |
| Leaked browser API key | `pk_live_` is read-only, origin-pinned, rate-limited. |
| Marketing site outage | Static on Cloudflare CDN. Only fails if CF global is down. |
| Email spam-folder | Resend SPF/DKIM/DMARC; plain templates, transactional only. |
| Surprise trial charge | Never auto-charge. Free rate-limits; never deletes, never upgrades. |

## 10. Open design questions

- **`<nlq-data>` security review** — external pentest of the template
  registry + CORS before public launch.
- **Better Auth on Workers** — verify device-code flow works without Node
  APIs; fallback: auth callbacks on a Fly.io machine.
- **D1 scale** — single D1 fine to ~10k users; revisit sharding at 100k.
- **MCP deep-link install** — one-click button is the goal; copy-paste
  accepted for v1.
- **Custom domains for embeds** — needs Cloudflare for SaaS (free for
  first 100 zones).

## 11. Immediate execution plan

See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for the phased plan. Short
version: wire DNS, stand up Cloudflare stack + Better Auth + Neon, build
the LLM router + plan cache, ship chat/CLI/MCP/elements/email stack, write
launch posts, recruit 5 design partners (one per persona, Free Pro for 12
months in exchange for 2 calls/month).

---

## 12. What this design is *not*

To avoid scope creep, things we are deliberately not doing in v1:

- A visual schema editor. (The schema is invisible.)
- A query builder. (You type English.)
- A migrations tool. (Schemas only widen. There are no migrations.)
- A team management UI beyond invite/remove. (Bigger orgs = enterprise.)
- A mobile app. (The web app is responsive; that's enough.)
- A "low-code" workflow builder. (`<nlq-data>` is the workflow builder.)
- A dashboard product. (Showcase examples will exist; the platform is not
  a BI tool.)
- An on-prem version. (Enterprise tier only, Phase 3.)
- Real-time subscriptions / changefeeds. (Phase 2 — we'll do it as
  `<nlq-stream>` then.)
- A GraphQL API. (REST + the embed element + MCP are enough surfaces.)
- A "Sign in with nlqdb" identity provider. (Possible Phase 2; not now.)

---

## 13. Reusable CI/CD — GitHub Actions

Eight repos (web, platform, CLI, MCP, elements, SDKs, infra, actions) need
the same jobs: lint → typecheck → test → build → scan → release. We refuse
to copy-paste YAML into 8 places.

**Design:** a dedicated `nlqdb/actions` repo owns one reusable workflow
(`.github/workflows/ci.yml@v1`) and a few composite actions
(`setup`, `llm-changelog`, `deploy-cloudflare`). Every consumer repo has
one 4-line `ci.yml` that calls it.

Reusable workflows (not just composites) because they carry
`permissions:`, `concurrency:`, matrix, and secrets. One tag (`@v1`), not
`@main` — moving targets break 8 repos at once.

### 13.1 Repository layout

```
nlqdb/actions/
├── .github/workflows/
│   ├── ci.yml            # reusable CI pipeline
│   └── release.yml       # reusable release pipeline
├── actions/
│   ├── setup/            # auto-detects node/go/python, installs + caches
│   ├── llm-changelog/    # changelog via tiered LLM call
│   └── deploy-cloudflare/  # wrangler deploy wrapper
```

### 13.2 Reusable CI workflow — properties

- One file, one entry point.
- **Auto-detects language** from `package.json` / `go.mod` / `pyproject.toml`.
  No `language:` input.
- **Concurrency-safe** — cancels in-flight runs on the same ref.
- **Cached aggressively** — Bun install cache (`~/.bun/install/cache`),
  `bun.lockb`, Go build cache, uv cache (`~/.cache/uv`).
- **Implicit matrix** — Ubuntu + repo's pinned version by default. Opt-in
  via `matrix-os:` / `matrix-versions:`.
- **Fast-fail order:** lint → typecheck → test → build → scan → release.
  Cheapest signal first.
- **Lint/format stack** (IMPLEMENTATION §2.8): **Biome** for JS/TS/JSON/CSS
  (single binary, no Prettier+ESLint duo); **gofumpt** + **golangci-lint**
  for Go; **ruff** for Python. Devs run the same commands locally via
  **lefthook** pre-commit hooks; CI is the backstop, not the first line
  of defense.
- **Free for public repos** — $0/mo per §7.

Inputs: `package-manager` (optional), `run-release` (default false),
`matrix-os`, `matrix-versions`. Secrets: `NPM_TOKEN`,
`CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY`, `CODECOV_TOKEN` — all
optional. Permissions: `contents: read`, `pull-requests: write`,
`id-token: write` (for OIDC publish). Per-language commands via
`case "$lang" in node|go|py) …`. Release job gated on
`inputs.run-release && ref == main && event == push` and uses
`llm-changelog` (Sonnet 4.6, per §8) then `changesets publish`. Full YAML
lives in `nlqdb/actions` — not duplicated here.

### 13.3 Consumer usage (every repo)

```yaml
# .github/workflows/ci.yml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  ci:
    uses: nlqdb/actions/.github/workflows/ci.yml@v1
    with:  { run-release: true }
    secrets: inherit
```

Four lines. Entire CI for any repo.

### 13.4 Release pipeline

Small repos: CI + release in the same file (above). Web-deploy repos
additionally call `deploy-cloudflare.yml@v1` from a `deploy.yml` —
same four-line consumer pattern.

### 13.5 Conventions enforced by CI

Conventional Commits (commit-lint in `lint:`); generated `CHANGELOG.md`
via `llm-changelog` (Sonnet 4.6); `changesets` for npm, tag-driven for
Go; every PR gets a sticky comment with build-size / coverage / p95-bench
deltas + preview-deploy link.

---

## 14. Usage by surface — the happy path for each tool

This section answers "what does it actually look like to use this." Every
block is the **goal-first default** (per §0.1). Power-user variants are
shown only when materially different.

### 14.1 Marketing site (`nlqdb.com`)

```
1. User lands on nlqdb.com.
2. Sees ONE input: "What are you building?"
3. Types: "an orders tracker for my coffee shop"
4. Hits Enter.
5. The page morphs in place into a chat. The first reply streams:
     "Set up. Tell me about an order — what should I track?"
6. User types: "customer name, what they ordered, time, total"
7. The chat replies with the inferred schema, a sample row, and an embed snippet.
   Total elapsed: 22 seconds. No sign-in. No pricing dialog. No "create your
   first database" button.
```

### 14.2 Platform web app (`app.nlqdb.com`)

```
- After step 7 above, a slim bar appears: "Save this — sign in with GitHub."
- User clicks; GitHub OAuth pops; back to the same chat, signed in, DB adopted.
- The left rail now shows one entry: `orders-tracker-a4f` (auto-named).
- User keeps chatting. Cmd+K opens the palette. Cmd+/ toggles the SQL trace.
- Settings → API keys → "Reveal pk_live_..." (publishable, browser-safe).
```

### 14.3 CLI (`nlq`)

**Default path** (one line, no setup, no sign-in until you want it):

```bash
$ nlq new "an orders tracker"
✓ Ready. Try: nlq "add an order: alice, latte, $5.50, just now"
ℹ Saved as anonymous. Run `nlq login` within 72h to keep it. (§3.3, §4.3)

$ nlq "add an order: alice, latte, $5.50, just now"
✓ Added. orders-tracker-a4f now has 1 row.
```

That's it. The DB exists. There is no `nlq db create` step the user had to know about.

**Adopting the anonymous DB** (seamless per §0 "Seamless auth"):

```bash
$ nlq login
→ Opening browser to approve this device… (fallback code: ABCD-1234)
✓ Signed in as maya@example.com. Adopted 1 anonymous DB: orders-tracker-a4f.
```

The browser lands on a single "Approve this device?" screen with the code
already pre-filled in the URL — one click, no typing. The refresh token is
written to the macOS Keychain (or libsecret / Credential Manager on other
OSes). Every subsequent call silently refreshes the access token as needed —
the user never sees "session expired".

**Day-2 ops** (still one line each):

```bash
$ nlq "how many orders today, by drink"
latte    ████████████  12
flat-white ██████      6
mocha    ██            2

$ nlq "export today's orders as csv > today.csv"
✓ Wrote 20 rows to today.csv
```

**Power-user path** (explicit, when the user cares):

```bash
$ nlq db create finance --engine postgres --region us-east
$ nlq query finance "monthly revenue last 12 months"
$ nlq connection finance     # raw Postgres URL — drop into your own app
```

### 14.4 MCP server (`@nlqdb/mcp`)

**Install** (one command, no arg; auto-detects what you have installed — per §3.4 and §4.3):

```bash
$ nlq mcp install
🔎 Scanning: Claude Desktop, Cursor, Zed, Windsurf, VS Code, Continue
✓ Found: Claude Desktop, Cursor

→ Opening browser to approve this device… (fallback code: AB12-CD34)
✓ Signed in as jordan@example.com.

✓ Claude Desktop  — wrote config; Claude Desktop is running, restart to activate? [Y/n] y
                    ↳ quit & relaunched. Self-check: ok.
✓ Cursor          — wrote config; hot-reloaded. Self-check: ok.

Done. Your MCP keys appear at nlqdb.com/settings/keys.
```

If only one host is installed, the prompt is skipped and the install is
silent. If none are installed, the CLI prints one line pointing the user at
`nlqdb.com/mcp` and exits — no harm done.

**Power-user forms** (escape hatches, always available):

```bash
$ nlq mcp install claude       # explicit host; skips auto-detection
$ nlq mcp install --all        # install into every detected host, no prompt
$ nlq mcp install --dry-run    # print what would happen; touch nothing
$ NLQDB_API_KEY=sk_... nlq …   # CI / Docker / air-gapped — env-var override
```

**Usage from inside the host LLM** (the agent doesn't need to know about
"databases"):

```
[Claude Desktop, after install]
User:  "Remember that I prefer metric units and I'm vegetarian."
Claude → calls tool: nlqdb_query("preferences", "remember: metric units, vegetarian")
       → tool returns: { ok, db: "preferences-93b" }
Claude:  "Got it. I'll remember."

[next session, hours later]
User:  "Plan me a Berlin food trip."
Claude → calls tool: nlqdb_query("preferences", "what do you remember about me?")
       → returns: "metric units, vegetarian"
Claude:  "Here's a vegetarian itinerary in km..."
```

The agent never called `nlqdb_create_database`. The DB materialized on
first reference. The agent's prompt has one tool, not two.

### 14.5 `<nlq-data>` HTML element

**Default (goal-first, the whole "backend"):**

```html
<script src="https://elements.nlqdb.com/v1.js" type="module"></script>

<nlq-data
  goal="the 5 newest orders, with customer and item"
  api-key="pk_live_xxx"
  template="table"
  refresh="10s"
></nlq-data>
```

That's the entire backend for a live order list. There is no API to write,
no schema to define, no JSON to parse, no React to render. The element
fetches, renders the table template, and refreshes every 10 seconds.

**Getting `api-key` is never a separate errand.** Every chat surface — web,
CLI, MCP — offers a "Copy snippet" action next to any generated query; the
copied HTML has the user's `pk_live_` already inlined. The user never has
to open the dashboard, find the keys page, click "Reveal", and paste.
The key is right there, in the code they were about to use.

**Day-2 (still no backend):**

```html
<form>
  <input name="customer" />
  <input name="drink" />
  <input name="total" />
  <nlq-action
    goal="add an order from this form"
    api-key="pk_live_xxx"
    on-success="reload"
  >Submit</nlq-action>
</form>
```

`<nlq-action>` is the write counterpart. Same template-registry safety
model as `<nlq-data>` (§3.5). The form's field names are inferred into
columns automatically.

### 14.6 HTTP API (when none of the above fit)

**Default (one endpoint; reads need no idempotency header):**

```bash
curl https://api.nlqdb.com/v1/ask \
  -H "Authorization: Bearer sk_live_..." \
  -d '{"goal": "an orders tracker", "ask": "how many orders today"}'

→ 200 {
  "answer": "12 today",
  "data": [{"count": 12}],
  "session": { "db": "orders-tracker-a4f", "key": "pk_live_..." },
  "trace": { "engine": "postgres", "sql": "...", "ms": 41 }
}
```

The `session.db` and `session.key` come back so the caller *can* go
DB-explicit on subsequent calls if they want. They don't have to.

**Writes** (anything that mutates state) require `Idempotency-Key`:

```bash
curl https://api.nlqdb.com/v1/ask \
  -H "Authorization: Bearer sk_live_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"ask": "add an order: alice, latte, 5.50"}'
```

The API **auto-classifies** the call; reads without a key succeed, writes
without a key return `400 idempotency_required` with a curl snippet in the
body showing the exact missing header. The user is never left guessing.

**Anonymous mode from curl** (no key, no sign-in — useful for `curl |` one-liners):

```bash
curl https://api.nlqdb.com/v1/ask \
  -d '{"goal": "an orders tracker", "ask": "how many orders today"}'
→ 200 { …, "session": { "anonymous_token": "anon_…" } }
```

Subsequent calls pass `Authorization: Bearer anon_…` to reuse the session.
72h window same as the web (§4.1).

**Power-user path** (the two-endpoint API from [`PLAN.md` §1.3](./PLAN.md))
remains available unchanged for callers who already think in DBs.

---

## 15. Persona walkthroughs — from zero to shipped

Each persona's actual goal, not a feature tour. Every step is what the
user does (left) and what nlqdb does in response (right). Nothing about
"first, create a database."

### 15.1 P1 — Maya, the Solo Builder

**Goal:** ship a meal-planner side project this weekend.

| Time | Maya does | nlqdb does |
|---|---|---|
| Fri 9:01pm | Lands on `nlqdb.com`, types *"a meal planner — dishes, ingredients, plans for the week"* | Materializes `meal-planner-7c2`, replies with inferred schema in NL, streams a `<nlq-data>` snippet for "this week's plan" **with her `pk_live_` key already inlined** — Copy-to-clipboard button right next to it |
| 9:03pm | Pastes the snippet into her existing Next.js project's `page.tsx` | Element fetches, renders an empty table, refreshes every 30s — zero config |
| 9:08pm | Types into the chat: *"add 12 sample dishes with realistic ingredients"* | Inserts 12 rows, returns the IDs and a preview |
| 9:15pm | Adds a `<nlq-action>` form to add new dishes from the UI | Inferred new columns where the form has new fields |
| 11:30pm | Deploys to Vercel. Site is live. | — |
| Sat 10am | Sister tests it. Maya types: *"who used the planner today, and which dishes were added"* | Replies in prose + table |
| Sun 6pm | *"add a `trial_ends_at` field to users, default 14 days from signup"* | Diff preview shown; Maya hits Enter; column added; existing rows backfilled |
| Mon 9am | Signs in to the platform; adopts the anonymous DB; adds a card; switches to Hobby ($10) | DB unpaused, 30-day backups on |

**What Maya never did:** wrote a migration file, opened psql, picked a
region, configured Prisma, set up an admin panel, configured backups, wrote
a single SQL statement.

**Setup time, old way:** ~1 day. **Setup time, nlqdb:** ~2 minutes.

### 15.2 P2 — Jordan, the Agent Builder

**Goal:** ship a research-agent that remembers things between sessions.

| Step | Jordan does | nlqdb does |
|---|---|---|
| 1 | On his laptop: runs `nlq mcp install`. The CLI auto-detects Claude Desktop + Cursor, opens the browser, he clicks Approve once. | Signs him in, mints a scoped MCP key per host, patches both configs, prompts him to restart Claude Desktop — all from one command. |
| 2 | In the agent's system prompt: *"You have a tool `nlqdb_query`. Call it with a `db` and a `q` in plain English. The `db` can be any string — it'll be created if new."* | — |
| 3 | Agent runs first session. On a fact: `nlqdb_query("research-memory", "remember: the user is researching solar panels in Berlin")` | DB `research-memory-...` materialized, row inserted |
| 4 | Agent ends session, reopens hours later: `nlqdb_query("research-memory", "what do I know about the user's research topic?")` | Returns the stored fact |
| 5 | Jordan watches the platform: clicks `research-memory`, sees every query the agent ran today, including the ones that returned zero rows | Trace + query log per [`PLAN.md` §2.2](./PLAN.md) |
| 6 | Deploys the agent on Modal. Sets `NLQDB_API_KEY` (from the dashboard) as a Modal secret — the one env var he touches. | Agent uses the `sk_live_` key; Modal's env-var flow stays idiomatic; no keychain or browser flow on the deploy target. |

**What Jordan never wrote:** a vector-store glue layer, a schema for memory,
a session-lifecycle service, a per-agent provisioning script, a metadata
DB sidecar.

**Code Jordan wrote:** ~40 lines of glue. ~95% reduction from a hand-rolled
memory layer.

### 15.3 P3 — Priya, the Data-Curious PM

**Goal:** answer the conference-leads question for the 4pm exec sync.

| Time | Priya does | nlqdb does |
|---|---|---|
| 2:15pm | Drags the vendor's CSV onto `nlqdb.com`. Types *"how many of these are already in our users table"* | Uploads CSV as `conference-leads-q2`, joins against the read-only mirror of prod (already permissioned), returns the count and a preview |
| 2:18pm | *"…and which plan are they on"* | Adds the join, returns table |
| 2:20pm | *"break it down by acquisition channel"* | Adds the group-by, returns chart-ready data |
| 2:22pm | Clicks "Share result" on the answer | Generates a permalinkable, redacted-by-default link to drop in Slack |
| 4:00pm | Walks into the meeting with the answer | — |

**What Priya never did:** opened a data-request ticket, pinged an engineer,
opened Excel, learned SQL, installed a BI tool, got prod credentials.

**Time saved on this one task:** ~1.5 days of waiting on engineering, plus
~30 minutes of Excel work.

### 15.4 P5 — Aarav, the Student

**Goal:** finish the CS50 final project (a blog).

| Step | Aarav does | nlqdb does |
|---|---|---|
| 1 | Opens `nlqdb.com` on the library laptop, types *"a blog with posts and authors"* | DB created anonymously (no signup), schema inferred, replies with the SQL it ran ("…in case you're curious — your assignment asks for it") |
| 2 | Pastes the SQL into his write-up | — |
| 3 | Types *"add a sample post by 'Aarav' titled 'hello world'"* | Inserts the row |
| 4 | Clicks "Copy starter HTML" in the chat — a pre-keyed `<nlq-data>` snippet lands on his clipboard | — |
| 5 | Pastes it into his static-HTML assignment | Renders the blog feed, no build step |
| 6 | *(Optional)* Signs in with GitHub to keep the DB past 72h | Anonymous DB adopted into his account in one SQL row (§4.1) |
| 7 | Submits the assignment | — |

**What Aarav never did:** ran `brew install postgresql`, dealt with a port
conflict, installed a CLI, learned what `pg_hba.conf` is, gave up on day 1.

The chat **also taught him** the SQL it generated, so he understands what
his own project does. The free tier costs us cents and produces a future
P1.

### 15.5 The pattern

First action is always stating a goal. DB is a silent consequence. Four
surfaces (chat, CLI, MCP, embed) are projections of one verb: *ask, in
plain English, against the data you care about*.

---

## 16. Hello-world e2e fullstack tutorial — the 1-pager

This is the tutorial we publish at `nlqdb.com/hello-world`. It is short on
purpose. If a reader has to scroll twice, we failed.

> ### Build a working orders tracker, end-to-end, in one HTML file.
>
> No backend code. No database setup. No build step. No framework.
>
> **1. Get your starter HTML (10 seconds, no card, no key-copying):**
>
> Go to `nlqdb.com`. Type *"an orders tracker"* in the box. The chat's first
> reply includes a **"Copy starter HTML"** button — click it. Your
> publishable key is already inlined; nothing to paste, nothing to search
> for. *(No sign-in required; the DB lives anonymously for 72h. Sign in
> anytime to keep it — see §4.1.)*
>
> **2. Save what you copied as `index.html`:**
>
> ```html
> <!doctype html>
> <html>
>   <head>
>     <script src="https://elements.nlqdb.com/v1.js" type="module"></script>
>     <title>Orders</title>
>   </head>
>   <body>
>     <h1>Today's orders</h1>
>
>     <nlq-data
>       goal="today's orders, newest first"
>       api-key="pk_live_abc123…yourkey"   <!-- pre-filled by the Copy button -->
>       template="table"
>       refresh="5s"
>     ></nlq-data>
>
>     <h2>Add one</h2>
>     <form>
>       <input name="customer" placeholder="customer" required />
>       <input name="drink"    placeholder="drink"    required />
>       <input name="total"    placeholder="total"    required type="number" step="0.01" />
>       <nlq-action
>         goal="add an order from this form"
>         api-key="pk_live_abc123…yourkey"
>         on-success="reload"
>       >Add order</nlq-action>
>     </form>
>   </body>
> </html>
> ```
>
> **3. Open it in a browser.**
>
> The table is empty. Submit one order. The table updates in 5 seconds.
> Submit another. It updates again. Open a second tab — same data.
>
> **4. Ship it.**
>
> Drop `index.html` on Cloudflare Pages, GitHub Pages, your own VPS,
> anywhere. There is nothing else to deploy.
>
> **What just happened:**
>
> - You did not write a database schema. nlqdb inferred `customer`,
>   `drink`, `total` from your form fields.
> - You did not write an API. The two custom elements *are* the API.
> - You did not write SQL. The chat translated your goals into queries
>   against an auto-provisioned Postgres.
> - You did not configure a backend. There isn't one of your own.
> - You did not pay anything.
>
> **What used to take a tutorial:**
>
> A typical "fullstack hello-world" in 2024 needed: a `package.json`, a
> framework (Next/Remix/Nuxt), an ORM (Prisma/Drizzle), a migrations
> folder, a Postgres provisioned somewhere, environment variables, two
> API routes, two React components, deployment config for both frontend
> and backend, and roughly 200 lines of code across 8 files. Total time:
> 1–3 hours for an experienced dev, a full day for a beginner.
>
> **This tutorial:** 1 file, ~25 lines, no setup, ~3 minutes.
>
> **Want to see what it actually ran?** Type *"show me the queries you
> ran for the orders form"* in your chat. Every request is traced.
>
> **Want to keep going?**
>
> ```html
> <nlq-data
>   goal="top 3 drinks today by revenue, with totals"
>   template="card-grid"
>   api-key="pk_live_..."
> ></nlq-data>
> ```
>
> Drop that anywhere in your HTML. New "endpoint", zero new code.

---

*Living document. Update via PR. Material changes require an entry in the
git log explaining the why, not the what.*
