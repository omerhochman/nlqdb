# nlqdb — High-Level System Design

> One-line vision: **a database you talk to, with a backend that doesn't exist.**
> You write HTML. Each component asks for what it wants in plain English. nlqdb answers.

This document is the high-level design. Phasing, deeper rationale and risks live in
[`PLAN.md`](./PLAN.md). User research lives in [`PERSONAS.md`](./PERSONAS.md). The competitive
landscape lives in [`COMPETITORS.md`](./COMPETITORS.md). This doc focuses on **what we build,
how the parts fit together, what tools we use, and how we ship it for $0/month**.

---

## 0. Core values (non-negotiable)

These are not aspirations. They are the acceptance criteria for every PR, every page,
every tool we ship. If a change violates one of these, it doesn't ship.

- **Free.** A real human can sign up, create a database, build a working app, and ship
  it to production without ever entering a credit card. Forever — not a 14-day trial.
- **Open source.** Core engine, CLI, MCP server, and SDKs are licensed permissively
  (Apache-2.0). The cloud platform is a managed convenience, not a moat.
- **Simple.** One way to do each thing. No flags that contradict each other. Two
  endpoints, two CLI verbs, one chat box. If a feature requires a tutorial, it failed.
- **Simple.** No config files for the first 60 seconds. No "choose your framework". No
  "pick a region". No schema. Smart defaults that are correct 95% of the time and
  visible 100% of the time.
- **Simple.** Every error message is one sentence and includes the next action.
  Documentation is short. The README fits on one screen.
- **Creative.** The product looks and feels different from every Tailwind-template SaaS.
  We are allowed — required — to have personality. See §7.
- **Simple.** No SDK is mandatory. `fetch` is the SDK. CLI works without a config file.
  MCP works with one env var.
- **Effortless UX.** Zero modals. Zero "are you sure" dialogs except for destructive
  actions. Keyboard-first. The chat is the product; everything else is a disclosure.
- **Simple.** If two engineers disagree on the design of a feature, we ship the simpler
  one and revisit only when a real user is blocked.
- **Fast.** p50 query latency < 400ms (cached path). p95 < 1.5s (LLM path with cache
  miss). Cold start < 800ms.
- **Fast.** First paint of the marketing site < 600ms on a 4G phone. Lighthouse 100/100/100/100.
- **Fast.** CLI binary < 8MB, starts in < 30ms. `nlq query` returns first byte in < 200ms
  on cache hit.
- **Bullet-proof by design, not by handling.** We avoid edge cases by **constraining
  inputs**, not by branching on them. Concretely:
  - Schema is inferred and **widened-only** — never narrowed. There is no "schema
    mismatch" branch because schemas can only grow.
  - Every mutating call requires an `Idempotency-Key`. Retries are safe by construction.
  - Plans are content-addressed by `(schema_hash, query_hash)`. Cache misses are the
    only state — there is no cache invalidation.
  - All writes go through the LLM-validated planner; raw arbitrary writes don't exist
    on the hot path.
  - Destructive ops are diff-previewed and require a second confirm. There is no
    "accidental delete" branch because accidents are not a reachable state.
  - All numeric inputs are rationals or bounded ints; no `NaN`, no `Infinity`, no
    silent overflow.
  - Secrets are scoped per-DB; there is no "wrong tenant" branch because tenants
    don't share routing.

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

The five user-facing surfaces (marketing, platform, CLI, MCP, embeddable HTML)
all hit the same edge router. There is one core engine. There are no parallel
implementations. (See [`PLAN.md` §1.5](./PLAN.md) — MCP is a thin adapter, not
its own backend.)

---

## 3. Surfaces

### 3.1 Marketing site — `nlqdb.sh`

The first thing the world sees. Built as a static-first **Astro** site (zero JS by default;
hydrate islands only when needed), so Lighthouse stays at 100/100/100/100 and the page
loads before the user blinks.

**Why Astro and not Next.js**: marketing pages are content. Astro ships ~0KB of JS by
default; Next.js ships React. We pay no React tax for a page that doesn't need React.
We use React/Svelte/Vue islands (`client:visible`) for the interactive demo only.

**Pages**:
- `/` — hero with a **live, in-page demo** of the chat. Type a query against a public
  example DB, see streamed results. No signup wall.
- `/docs` — MDX, full-text searchable, 100% offline-capable PWA.
- `/pricing` — see §6.
- `/manifesto` — the values from §0, rewritten for humans.
- `/blog` — build-in-public posts, technical deep-dives, OSS release notes.
- `/showcase` — sites built with `<nlq-data>` (community-submitted, MR-merged).

**Creative direction** (anti-template):
- **Neo-brutalist meets terminal**: thick borders, hard shadows (no glassmorphism),
  monospace headlines (JetBrains Mono Variable), one bright accent color (we'll
  pick: probably **Acid Lime `#C6F432`** on near-black `#0B0F0A`). The accent only
  shows on interactive elements — restraint is the design.
- **Live "what's running right now"** ticker at the top: real anonymized query
  fingerprints streaming past, with engine + latency. *"`postgres · 41ms · SELECT
  count(*) FROM orders WHERE country='DE'`."* Proof the thing is alive.
- **Scroll-driven story**: as you scroll the homepage, an actual database is
  *being built* on the side — schema appears, rows insert themselves, queries
  run. View Transitions API for the morphs. CSS scroll-driven animations
  (no JS scroll libraries).
- **No stock photos. No illustrations of "people using a laptop"**. The hero
  visual is the product itself, running.
- **Kinetic typography** on the headline: the word *"talk"* in *"a database
  you talk to"* is a live LLM stream — letters appear as if being thought.
  (Pre-recorded; no real LLM call on first paint.)
- **Real-time GitHub star count** in the nav. Honest social proof.
- **No cookie banner** because we use no third-party cookies. (Plausible
  Analytics, self-hosted, GDPR-exempt.)

**AEO/GEO (Answer Engine Optimization, 2026 best practice)**:
- Every page has a **Definition Lead** sentence: *"nlqdb is a natural-language
  database that handles both data storage and backend logic, queried in plain English."*
- `FAQPage`, `HowTo`, `SoftwareApplication`, and `Article` JSON-LD on every relevant page.
- Direct answer block (≤15 words) in the first 150 words of each page, so
  Perplexity/ChatGPT/Gemini/Claude cite us.
- `llms.txt` at the root with crawl-friendly summaries of every doc page.
- Identical NAP/value-prop across GitHub, npm, X, LinkedIn, Product Hunt,
  Hacker News profile.
- `sitemap.xml` + `robots.txt` permissive to AI crawlers (GPTBot, ClaudeBot,
  Google-Extended, PerplexityBot, etc.) — discovery is the goal.
- Multimodal: every video has a transcript and timestamped chapters.

**Hosting**: Cloudflare Pages (free tier: unlimited static requests, 500 builds/mo).

### 3.2 Platform web app — `app.nlqdb.sh`

The signed-in surface. Same Astro project, different routes; React islands for
the chat and dashboard.

- **Chat** (the product) — see [`PLAN.md` §1.2](./PLAN.md). Three-part response
  (answer / data / trace). Streaming. In-place edit + re-run. Cmd+K palette.
- **Database list** — left rail. Each DB shows engine, size, last query.
- **Settings** — API keys (rotate, revoke), team members (Phase 1.5), billing,
  usage with live $ counter (so the user always knows what they'd pay if they
  weren't on free).
- **Embed snippets** — copy-paste `<nlq-data>` HTML for any DB.
- **One escape hatch**: a "Show connection string" button. Click reveals the raw
  Postgres URL. Power users are first-class.

**Component model**: Astro routes + React islands. State is URL-first
(every chat is permalinkable) + a small Zustand store. No global Redux.

### 3.3 CLI — `nlq`

Single static binary. Go (smaller binary, faster startup than Node; we don't
need npm distribution as the primary channel).

**Naming research** (NPM registry, April 2026):
- `nlqdb` — taken on npm (squatted/in use). We do **not** use it as the binary name.
- `nlq` — taken on npm. We do **not** publish under this scope.
- `@nlqdb/*` — scope is **available**; we own it.
- The **binary** is `nlq` (3 chars, easy to type, no collision risk on `$PATH` —
  it's not a common Unix command).
- The **npm packages** are scoped: `@nlqdb/cli`, `@nlqdb/mcp`, `@nlqdb/sdk`,
  `@nlqdb/elements` (the web component).
- Install command: `curl -fsSL https://nlqdb.sh/install | sh` installs the Go
  binary to `~/.local/bin/nlq`. Homebrew tap: `brew install nlqdb/tap/nlq`.
  npm path (for Node-native users): `npm i -g @nlqdb/cli` exposes the same
  `nlq` command (a small Node shim that downloads the binary on first run).

**Convention rationale** (per modern CLI norms — `gh`, `fly`, `wrangler`):
- Binary is one short word, never `-cli` suffixed.
- Subcommand-first: `nlq <noun> <verb>`. Verb-first (`nlq create db`) reads
  worse and conflicts with `gh`-style convention.
- Output is human by default; `--json` for scripts; never auto-detect TTY.
- Every command takes a DB positional. `nlq use orders` writes
  `~/.config/nlqdb/config.toml` and is visible.

**Surface** (see [`PLAN.md` §1.4](./PLAN.md) for the full list):
```
nlq login                    # opens browser → Better Auth device-code flow
nlq db create orders
nlq db list
nlq query orders "how many signups today"
nlq chat orders              # interactive REPL, streams
nlq connection orders        # prints the raw Postgres URL (escape hatch)
nlq mcp install claude       # installs the MCP config into Claude Desktop
```

### 3.4 MCP server — `@nlqdb/mcp`

Distributed via `npx -y @nlqdb/mcp`. Same code path as the HTTP API — see
[`PLAN.md` §1.5](./PLAN.md). Tools exposed:
- `nlqdb_create_database(name)`
- `nlqdb_query(database, q)`
- `nlqdb_list_databases()`
- `nlqdb_describe(database)` — returns inferred schema in NL

Auth via env var `NLQDB_API_KEY` or the host's secret store. One-click install
buttons on the website for Claude Desktop, Cursor, Zed, Windsurf, VS Code.

### 3.5 The embeddable HTML element — `<nlq-data>`

**This is the bet.** A web component (custom element) that any developer can drop
into static HTML. Distributed as `@nlqdb/elements` (one CDN URL: `https://elements.nlqdb.sh/v1.js`).

```html
<script src="https://elements.nlqdb.sh/v1.js" type="module"></script>

<nlq-data
  db="coffee-shops"
  query="the 5 most-loved coffee shops in Berlin, with photos"
  api-key="pk_live_..."
  template="card-grid"
  refresh="60s"
></nlq-data>
```

**How it works**:
1. The element issues a `POST /v1/db/coffee-shops/query` with `{ q, render: "html" }`.
2. The API returns `{ answer, data, html, trace }`. The `html` is a sanitized
   fragment rendered server-side using one of a small library of safe templates
   (`card-grid`, `table`, `list`, `kv`, `chart`, `raw`).
3. The element morphs its inner DOM with View Transitions API. Skeleton on first
   load, no layout shift.
4. `refresh="60s"` triggers a re-fetch on a timer; SSE upgrade is automatic if the
   browser supports it.

**Why this is bullet-proof by design**:
- The element only **reads** from the server-rendered template registry. The LLM
  never returns raw HTML to the browser. Templates are the equivalent of a
  declarative UI registry (the Tambo/A2UI pattern), so XSS is structurally
  impossible.
- `api-key` is a **publishable** key (`pk_live_…`), scoped per-DB to read-only
  queries with rate limits. Mutating writes from the browser require a second
  signed token.
- CORS is enforced per-API-key with a per-key `allowed_origins` list.
- The element ships < 6KB gzipped, no dependencies.

**Why this matters**: a developer building a side project writes **no backend
code, no SQL, no JSON parsing**. The HTML element *is* the backend.

---

## 4. Authentication & identity

### 4.1 Choice: **Better Auth** (TypeScript, OSS, headless) as the library, on our
own infrastructure (Cloudflare Workers + D1).

**Why not Clerk** (despite [`PLAN.md` §1.6](./PLAN.md) initially recommending it):
- Free tier is 10k MAU, then a pricing cliff.
- We're an OSS company; using a vendor for the most-touched part of the stack
  signals hypocrisy.
- Clerk vendor-locks our user data shape and webhook contract.

**Why Better Auth**:
- Open source, MIT-licensed, no per-MAU fees ever.
- Framework-agnostic; works in our Workers runtime.
- Strong TypeScript types end-to-end with our Drizzle schema.
- The Auth.js team merged into Better Auth (Sept 2025); it is the de-facto
  TypeScript auth standard in 2026.
- Pluggable: passkeys, 2FA, magic link, social, OAuth provider mode (so we can
  later let other apps "Sign in with nlqdb").
- Trade-off: we build the UI ourselves. We were going to anyway — the auth
  page is part of the brand.

**Methods enabled at launch**:
- **Magic link** (email) — primary path. Lowest friction.
- **Passkey** (WebAuthn) — promoted on second visit.
- **GitHub OAuth** — every dev has one.
- **Google OAuth** — for the non-dev audience.
- No password ever. We do not store passwords.

**Anonymous mode**: as in [`PLAN.md` §1.1](./PLAN.md), the user can create a DB and
query it before signing in. We issue an opaque token in `localStorage`; the DB
survives 72h tied to that token. On sign-in we adopt the anonymous DB into the
account. **One row in the schema, zero conditional code.**

**Session storage**: Cloudflare Workers KV (free: 100k reads/day, 1k writes/day).
Sessions are JWT-signed for read; KV is the revocation store.

**API keys**: separate from sessions. Two key types:
- `pk_live_...` — publishable, browser-safe, read-only, per-DB, origin-pinned.
- `sk_live_...` — secret, server-only, full scope. Rotated via dashboard or CLI.

Keys are stored hashed (Argon2id). No plaintext key ever leaves the dashboard
after creation.

### 4.2 Authorization model

Tiny on purpose:
- **Owner** — the user who created the DB. Full rights.
- **Member** — invited; read + query rights, no destructive ops, no key creation.
- **Public** — anonymous; read-only via publishable key, rate-limited.

That's the entire model in Phase 1. Roles/RBAC come in Phase 2 only if a paying
customer asks twice.

---

## 5. Email, content & marketing

### 5.1 Transactional email — **Resend** (free tier: 3k/mo, 100/day)

- Magic links, password-less verification (we don't even have passwords, but
  email verification on first sign-in).
- Billing alerts ("you've used 80% of your monthly quota").
- Critical security alerts ("new device signed in").
- DB-paused notification ("your `orders` DB will pause in 48h unless queried").

Templates built with **React Email** (lives in our monorepo, type-shared with
the API). Every email has a one-line plain-text fallback and **no marketing
content** — transactional means transactional.

If we exceed Resend's free tier, fallback path is **AWS SES** (~$0.10/1k emails,
basically free at our scale) via the same React Email templates — we keep our
own templates so the vendor can swap with one env var.

### 5.2 Marketing email — **Listmonk** (open source, self-hosted on a $0 Fly.io
machine, sending via SES)

- Newsletter (opt-in only — no pre-checked box, ever).
- Product launch announcements.
- Build-in-public weekly digest.
- Tied to Plausible Analytics for click-through, no third-party trackers in
  emails (no `1×1 pixel` from a SaaS provider).

### 5.3 Content & marketing strategy

The flywheel for an OSS dev tool in 2026 is **community-led + docs-first**.

**Channels**, in priority order:
1. **GitHub** — repo is the landing page for half our audience. Clean README,
   active issue triage, weekly release cadence, contributor recognition.
2. **Documentation** — every doc page is SEO-optimized (and AEO-optimized).
   A quickstart in 30 lines, a recipe per persona ([`PERSONAS.md`](./PERSONAS.md)).
3. **Build-in-public on X and LinkedIn** — weekly thread: a real metric (queries
   served, cache hit rate, p95 latency, MRR), a real failure, a real ship.
   Authentic only — fake transparency is detectable and it kills trust.
4. **Hacker News** — "Show HN" for major launches: v1, MCP server, the
   `<nlq-data>` element, the auto-migration engine. Technical depth posts;
   never marketing fluff.
5. **Product Hunt** — for the visual launches (the embeddable element, the
   redesigned chat). Tier-2 channel.
6. **Reddit** — `r/webdev`, `r/programming`, `r/ClaudeAI`, `r/LocalLLaMA`,
   `r/htmx`, `r/databases`. Genuine participation; no drive-by promotion.
7. **Discord community** — single server, three channels (`#help`, `#showcase`,
   `#building`). The team is in there visibly.
8. **YouTube / X video** — short demos. *"Build a Twitter clone in one HTML file"* —
   with `<nlq-data>` it's actually true. Each demo also feeds AEO (transcripts).
9. **Conference talks** — pgconf, JSConf, MCP-focused events. Speaker = founder
   for the first year.

**Content cadence** (sustainable solo, scale later):
- 1 long-form blog post / week (technical, 1000-2500 words).
- 3 build-in-public threads / week.
- 1 release / week (even if tiny).
- 1 community spotlight / month.

**Anti-patterns we refuse**:
- Cold outbound email. Ever.
- Paid ads in Phase 1 — if we need to buy attention, the product isn't ready.
- Influencer partnerships pre-PMF.
- Lifetime deals on AppSumo (per [`PLAN.md` §5.6](./PLAN.md)).
- "Gated" content (whitepaper-for-email). Everything is public.

### 5.4 Analytics

- **Plausible Analytics**, self-hosted on the same Fly.io free machine as
  Listmonk. GDPR-exempt, no cookie banner, no third-party tracking.
- **Sentry** (free tier: 5k errors/mo) for app errors.
- **PostHog** (self-hosted, free) only if we genuinely need product analytics
  beyond Plausible — which probably means in Phase 2.
- **OpenTelemetry** → **Grafana Cloud** free tier for backend traces (per
  [`PLAN.md` §1.6](./PLAN.md)).

---

## 6. Pricing — freemium done honestly

Aligned with [`PLAN.md` §5](./PLAN.md). The constraint: **a real user must be
able to ship a real product without paying us.**

| Tier | Price | What you get | Limits | Card required |
|---|---|---|---|---|
| **Free** | $0 forever | Unlimited DBs, full chat, CLI, MCP, embed element, all templates, 7-day backups, community support, public showcase | 1,000 queries/mo, 500MB/DB, DBs pause after 7d idle (resume in <2s), 100 emails/day from your DBs | **No** |
| **Hobby** | $10/mo | Everything in Free + no pausing, 30-day backups, email support, custom domain on `<nlq-data>` embeds, 5 team members | 50,000 queries/mo, 5GB/DB, 5k emails/day | Yes |
| **Pro** | Usage-based, $25/mo minimum | Everything in Hobby + dedicated compute when you cross the threshold, 30-day PITR, priority Slack support, SSO (Google Workspace) | Metered: $0.0005/query above 50k, $0.10/GB-mo above 5GB, hard cap user-set | Yes |
| **Enterprise** | Custom | VPC peering, SAML SSO, audit-log export, custom SLA, dedicated support, on-prem option | Negotiated | Annual contract |

**Free-tier guarantees** (the part most "freemium" SaaSes lie about):
- No credit card to use the free tier. Period.
- Hitting the free limit **rate-limits**, never deletes data, never silently
  upgrades. The user sees: *"You've used 1,000 queries this month. Add a card
  for more, export your data anytime, or wait until next month."*
- Free tier features are not a degraded subset designed to nag — every feature
  works. We restrict **scale**, not capability.
- Export is one click, always free, even after cancellation, for 90 days.
- DBs auto-pause after 7d idle to save us cost; resume on first query in <2s.
  We tell the user this clearly when they create the DB.

**Honest billing** (per [`PLAN.md` §5.3](./PLAN.md)):
- First charge is double-confirmed via email.
- Soft cap at 80% of user's monthly budget — email warning.
- Hard cap default at 100% — requires one-click extension.
- Cancellation = one click. No call. No exit survey before cancellation.

**Stack**:
- **Stripe Billing** for invoicing + checkout (Stripe-hosted, no card forms in our app).
- **Stripe Tax** for international tax handling.
- **Lago** (self-hosted, OSS, on the same Fly.io free machine) for usage metering.
  Lago batches `query_executed` events from our edge into Stripe invoices. Sub-ms
  hot-path overhead.

---

## 7. The $0/month launch stack

A real, line-by-line accounting of how we ship the entire system to production
spending $0/month until we have paying customers.

| Concern | Tool | Free tier (April 2026) | Why |
|---|---|---|---|
| Marketing site hosting | **Cloudflare Pages** | Unlimited requests, 500 builds/mo, 20k files | Best free tier, zero egress, global CDN |
| Edge compute (router + API) | **Cloudflare Workers** | 100k requests/day, 10ms CPU/req | Same network as Pages, no glue code, no cold starts |
| Auth session storage | **Cloudflare Workers KV** | 100k reads/day, 1k writes/day | Same network as Workers; reads are most ops |
| Plan cache | **Cloudflare KV** | as above | Content-addressed, read-heavy — perfect fit |
| Primary database (control plane) | **Cloudflare D1** | 5M rows read/day, 100k writes/day, 5GB | SQLite-compatible, scale-to-zero, free |
| User databases (Postgres) | **Neon** free tier | 0.5GB storage, scale-to-zero | Branching, instant create, HTTP API |
| User databases (Redis) | **Upstash** free tier | 10k commands/day, 256MB | HTTP API — works from Workers |
| Object storage (backups, logs) | **Cloudflare R2** | 10GB storage, 1M Class A ops/mo | **Zero egress fees** — critical |
| Email (transactional) | **Resend** | 3k/mo, 100/day | Best DX, React Email integration |
| Email (marketing) | **Listmonk** (self-hosted) | unlimited, sending via SES | OSS, no vendor lock |
| Email fallback / SES sending | **AWS SES** | 62k/mo free from EC2, ~$0.10/1k otherwise | Cheap, reliable, multi-region |
| Auth library | **Better Auth** | OSS, free | TypeScript-native, no MAU fees |
| Payments | **Stripe** | 0% until first charge; 2.9%+30¢ after | Industry standard, hosted checkout |
| Usage metering | **Lago** (self-hosted) | OSS, free | API-first, batches into Stripe |
| App errors | **Sentry** free | 5k errors/mo, 1 user | Enough for early days |
| Web analytics | **Plausible** (self-hosted) | OSS, free | GDPR-exempt, no cookie banner |
| Backend traces | **Grafana Cloud** free | 10k metrics, 50GB logs | OTEL standard, swap later |
| Long-running compute (Listmonk, Plausible, Lago) | **Fly.io** | 3 small machines free, 3GB volumes | API-first, per-second billing if we exceed |
| Domain | `nlqdb.sh` | ~$30/yr (the only fixed cost) | Required; not avoidable |
| LLM inference | Anthropic / OpenAI / Together credits | $5–10k startup credits available | We apply for credits Day 1 |
| Code hosting + CI | **GitHub** | Free for OSS repos, 2k Action minutes | Standard |
| MCP distribution | **npm** | Free | Standard |
| CLI distribution | **GitHub Releases** + Homebrew tap | Free | Standard |

**Total monthly cost at zero users**: $0 + ~$2.50 amortized for the domain.
**Total monthly cost at ~1k free users, ~10k queries/day**: still $0 once
LLM credits kick in; ~$30–60/mo otherwise (mostly LLM tokens; mitigated by
the plan cache — see [`PLAN.md` §5.1](./PLAN.md)).

**Single-vendor warning**: we deliberately concentrate on Cloudflare for
the hot path because (a) staying inside one network avoids cross-cloud
latency and CORS pain, (b) the free tier is the most generous, (c) zero
egress is a structural cost advantage. We mitigate vendor risk with an
adapter layer per service (per [`PLAN.md` §7](./PLAN.md)) — the day we need
to leave Cloudflare, we leave in a week.

---

## 8. AI model selection — the right model for each job

A tiered routing strategy. We **never** send all traffic to a frontier model.
Pricing is approximate, April 2026.

| Job | Tier | Model | Why | Approx $/1M tok (in/out) |
|---|---|---|---|---|
| **Hot-path query classification** (read/write/ambiguous/destructive) | Tier 1 | **GPT-5.4 Nano** *or* **Gemini 3.1 Flash-Lite** | Sub-100ms, cheap, accuracy good enough for routing | $0.20 / $0.50 |
| **Schema embedding** (table + column names + samples) | Tier 1 | **Gemini 3.1 Embeddings** *or* self-hosted **bge-m3** on a single A10 once traffic justifies | Long context for big schemas; cheap | ~$0.02/1M |
| **NL → query plan** (the workhorse — 80% of LLM cost) | Tier 2 | **Claude Sonnet 4.6** | Best instruction-following + structured output for SQL/Mongo grammars at sane price | $3 / $15 |
| **Hard plans / ambiguous queries / multi-engine reasoning** (≤5% of traffic) | Tier 3 | **Claude Opus 4.7** | Best agentic + reasoning for the long tail | $5 / $25 |
| **Result summarization** (rows → prose) | Tier 1 | **GPT-5.4 Nano** *or* **DeepSeek V3.2** | Cheap, fluent, no reasoning needed | $0.20 / $0.50 |
| **MCP/tool-use loops** (when an agent calls us) | Handled by the **caller's** model — we don't pay | — | — | — |
| **Workload analyzer** (background, batch) | Tier 3 | **Claude Opus 4.7** *or* **Gemini 3.1 Pro** | Long context, complex reasoning over query log; runs once per DB per few hours | $5 / $25 |

**For our internal development** (the people building nlqdb, not the runtime):

| Job | Recommended model | Why |
|---|---|---|
| Architecture design / planning docs (this file) | **Claude Opus 4.7** | Best at long-form structured reasoning |
| Day-to-day code generation (TypeScript / Go) | **Claude Opus 4.7** in Cursor | Best SWE-bench scores at instruction following |
| Quick refactors, boilerplate | **Claude Sonnet 4.6** | 5× cheaper, near-identical quality on small tasks |
| Code review / bug hunting | **GPT-5.4** or **Gemini 3.1 Pro** | Different model for second opinion catches more |
| Generating test fixtures / mock data | **DeepSeek V3.2** | Cheapest reasonable model, plenty good for fixtures |
| Marketing copy, blog drafts | **Claude Opus 4.7** | Best prose quality |
| SEO/AEO content optimization | **Gemini 3.1 Pro** | Native Google ecosystem, surfaces well in AI Overviews |
| Image / illustration generation | **Imagen 4** or **Flux 1.5 Pro** | We mostly avoid — see §3.1 (no stock illustrations) |

**Cost-control rules** (apply to every LLM call in production):
1. **Plan cache first**, LLM second. Target 60–80% cache hit on mature workloads
   (per [`PLAN.md` §5.1](./PLAN.md)).
2. **Smallest model that solves the task wins**. Confidence-based escalation:
   only escalate to Sonnet if Nano returns low confidence, only escalate to
   Opus if Sonnet does.
3. **Prompt caching** on every provider that supports it (Anthropic, Google).
   System prompts are stable; user queries are short. ~80% input cost reduction.
4. **No streaming summarization** for `Accept: application/json` calls — the
   summary step is skipped when the client wants raw data.
5. **Self-host the classifier** once we have ~50k queries/day. A single A10G
   on Modal running a quantized 8B model handles classification at ~$200/mo
   flat — pays back in weeks.

---

## 9. The bullet-proof-by-design checklist

Every design decision in this doc maps to an invariant. We don't catch edge
cases — we make them unreachable. Concrete examples:

| Edge case (in a normal system) | How we make it unreachable |
|---|---|
| "Schema mismatch" between writes | Schemas only widen, never narrow. New column = `ALTER TABLE ADD COLUMN ... NULL`. |
| "Cache invalidation" bugs | Plan cache is content-addressed by `(schema_hash, query_hash)`. Schema change = new hash = new cache key. Old entries expire by LRU. |
| "Race condition on signup" | Signup is idempotent on email. Second signup with same email = sign-in. |
| "Double-charge" on retry | All mutating API calls require `Idempotency-Key`. Stripe webhooks deduped on event ID. |
| "Wrong-tenant data leak" | Tenancy is enforced at the connection-pool layer, not in app code. App code can't see another tenant's connection — there's no branch to take. |
| "Forgot to escape SQL" | We don't write SQL strings. The planner emits a typed plan; the executor binds parameters. |
| "Cold start timeout" | Cloudflare Workers cold-start in <5ms. Neon resumes paused DBs in <1s. Hard ceiling on first-byte: 2s; we degrade to "loading" UI before the user notices. |
| "LLM hallucinates a column" | Static validation against the schema after plan generation. Hallucinations are caught before execution; the LLM is re-prompted with the validation error. |
| "User deletes everything" | Destructive plans show a diff preview and require a second Enter. The diff is generated from the plan itself, not after execution. |
| "Browser-side API key leaked" | Publishable keys are read-only, origin-pinned, per-DB, rate-limited. Worst case: someone scrapes your public DB at the rate you allowed them to. |
| "Marketing site goes down during launch" | Static-only on Cloudflare CDN. The only way this fails is if Cloudflare's entire global network is down. |
| "Email goes to spam" | Resend handles SPF/DKIM/DMARC. Templates are plain, no images, transactional only — high deliverability by construction. |
| "Trial expires and surprise-charges $400" | We **never** auto-charge. Free tier rate-limits; never deletes; never upgrades. Hard rule. |

This is what *"bullet-proof to all edge cases without handling edge cases"*
looks like in practice. It's not magic. It's choosing data structures and
contracts that make the bad states unrepresentable.

---

## 10. Open design questions (to resolve before Phase 1 ships)

Mostly inherited from [`PLAN.md` §8](./PLAN.md), with platform-specific adds:

- **`<nlq-data>` security review.** The element is the most exposed surface.
  Before public launch, an external pentest of the server-side template
  rendering and CORS rules.
- **Better Auth on Workers** — verify the device-code OAuth flow works in
  the Workers runtime without Node APIs. Fallback: a separate Fly.io machine
  for auth callbacks if needed.
- **D1 query patterns** — can the control plane (users, DBs, keys, billing
  events) live in a single D1 instance, or do we shard? At ~10k users, single
  D1 is fine; revisit at 100k.
- **MCP discovery** — can we auto-register the server in Cursor / Claude
  Desktop / Zed via deep links, or does the user copy-paste a config? The
  one-click button is the goal; we accept copy-paste for v1.
- **Custom domains for `<nlq-data>`** — Hobby tier feature, but the cert
  provisioning needs Cloudflare for SaaS (free for the first 100 zones).

---

## 11. Immediate execution plan

(Tightened version of [`PLAN.md` §9](./PLAN.md) with this design's specifics.)

1. Register `nlqdb.sh`. Park the Astro hero with the live demo. Open-source
   the repo on day 1. Apply for Anthropic, OpenAI, Google startup credits.
2. Stand up the Cloudflare-only stack: Pages + Workers + KV + D1 + R2.
3. Stand up Better Auth on Workers, magic-link only. One sign-in page.
4. Wire Neon's HTTP driver into Workers. Create a single shared Postgres
   pool, schema-per-DB.
5. Build the LLM router (Tier 1 / Tier 2 / Tier 3) as a single edge function
   with the plan cache in KV.
6. Ship the chat UI as one Astro route with a React island.
7. Ship the Go CLI: `nlq login`, `nlq db create`, `nlq query`, `nlq chat`.
8. Ship `@nlqdb/mcp`. Submit the one-click installers.
9. Ship `@nlqdb/elements` v0 with `card-grid`, `table`, `list`, `kv` templates.
10. Set up Resend, Listmonk on Fly, Plausible on Fly, Lago on Fly. Stripe in
    test mode.
11. Write the launch posts (one per surface). Schedule for the first calm
    Tuesday.
12. Recruit the 5 design partners ([`PERSONAS.md`](./PERSONAS.md) — one of each
    persona). Free Pro for 12 months in exchange for 2 calls/month.

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

*Living document. Update via PR. Material changes require an entry in the
git log explaining the why, not the what.*
