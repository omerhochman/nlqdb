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
- **Seamless auth — one identity, four surfaces, zero friction.** Authentication is
  a core feature, not a gate. Concretely, and non-negotiably:
  - **No login wall before first value.** Every surface (web, CLI, MCP, embed)
    produces a working answer before asking who you are. Anonymous-mode is the
    default path, not a footnote (see §4.1).
  - **One sign-in covers everything.** A single Better Auth identity is shared
    across `nlqdb.com`, `app.nlqdb.com`, the `nlq` CLI, and every MCP host. Signing
    in once anywhere signs you in everywhere on that device. No separate CLI
    password, no separate MCP token to copy-paste, no second account.
  - **Tokens refresh silently.** The user never sees a 401, never sees "session
    expired", never has to re-run a command because a token aged out. Access
    tokens are short-lived (1h) and refreshed in the background; the refresh
    token lives in the OS keychain. If the refresh fails, the surface re-opens
    the browser flow automatically and resumes the original command.
  - **MCP install is one command, no arg.** `nlq mcp install` auto-detects
    the MCP hosts installed on the machine (Claude Desktop, Cursor, Zed,
    Windsurf, VS Code, Continue), does sign-in (if needed), provisions a
    host-scoped key per host, and patches each host's config. The user
    never sees the word "token", "host ID", or "API key" unless they
    explicitly ask. Explicit `nlq mcp install <host>` remains a power-user
    override.
  - **Credentials are never in plaintext files.** CLI and MCP credentials live
    in the OS keychain (macOS Keychain / Windows Credential Manager / libsecret).
    `~/.config/nlqdb/config.toml` holds only non-secret preferences. Env-var
    overrides (`NLQDB_API_KEY`) exist for CI but are never the default path.
  - **Revocation is instant and visible.** Every token on every device appears
    in the dashboard with last-used timestamp. Revoke = one click; the affected
    surface re-prompts for sign-in on the next call, seamlessly.
- **Simple.** If two engineers disagree on the design of a feature, we ship the simpler
  one and revisit only when a real user is blocked.
- **Fast.** p50 query latency < 400ms (cached path). p95 < 1.5s (LLM path with cache
  miss). Cold start < 800ms.
- **Fast.** First paint of the marketing site < 600ms on a 4G phone. Lighthouse 100/100/100/100.
- **Fast.** CLI binary < 8MB, starts in < 30ms. `nlq query` returns first byte in < 200ms
  on cache hit.
- **Goal-first, not DB-first.** No persona ever woke up wanting to "create a
  database." They want a meal-planner, a research agent, a one-off answer for
  the 4pm exec sync, a CS50 final. The DB is plumbing. The on-ramp must lead
  with **the user's goal**, and create the DB silently as a side effect of
  pursuing it. See §0.1.
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

## 0.1 On-ramp inversion (the most important design principle)

Re-reading [`PERSONAS.md`](./PERSONAS.md) carefully: **none of our top personas
have "create a database" as a goal.** Maya wants a meal-planner shipped by
Sunday. Jordan wants an agent that remembers things between sessions. Priya
wants the conference-leads number for her 4pm sync. Aarav wants to pass CS50.
The database is a *side effect of the thing they're trying to do*. If the
on-ramp asks "name your database" first, we have already failed the values in
§0 even if every byte after that is perfect.

**The inversion:** every surface is reframed so the user's first action is
**stating their goal**, and the database materializes as a consequence.

| Surface | Old framing (DB-first) | New framing (goal-first) |
|---|---|---|
| Marketing hero | "Name your database" | "What are you building?" *(or: "Ask anything.")* |
| Platform first run | Empty dashboard, "Create database" button | Single chat input, no concept of "DB" until needed |
| CLI first command | `nlq db create orders` | `nlq new "an orders tracker"` (creates the DB silently) |
| MCP first call | `nlqdb_create_database("memory")` | `nlqdb_query("memory", "remember that...")` *(DB autocreated on first reference)* |
| `<nlq-data>` first attribute | `db="orders"` is required | `goal="..."` is the lead; `db` is optional and inferred from the goal on first call |
| HTTP API | `POST /v1/databases` then `POST /v1/db/{id}/query` | `POST /v1/ask { "goal": "..." }` returns a session that includes the DB it created |

**Mechanism** (one rule, applied everywhere): every entry point accepts a
**goal** in plain English. The first call materializes a DB derived from the
goal (slug + short hash for collision resistance), persists it under the
caller's identity (or anonymous token), and returns a session object that
*also contains* the DB handle for power users. The caller never has to ask
for the DB. They get one anyway.

**Why this is structurally simpler, not just nicer copy:**
- The "create DB" endpoint becomes an internal function, not a public verb.
  One fewer concept in the public surface.
- Auto-named DBs eliminate the "what should I call it" decision — the #1
  abandonment point in our 60-second test (per the validation plan in
  [`PERSONAS.md`](./PERSONAS.md)).
- The CLI, MCP, and embed element all converge on **one verb** (`ask` /
  `query` / `goal`). The four surfaces stop drifting.
- Anonymous-mode (the 72h adoption window from [`PLAN.md` §1.1](./PLAN.md))
  becomes the default path, not a footnote.

**The DB never disappears as a concept** — it is always one click / one flag
away. Power users can still `nlq db create exact-name`, still set `db="orders"`
explicitly, still hit the legacy two-endpoint path. Goal-first is the
**default**, not the only way. (Per §0: escape hatches are first-class.)

The rest of this doc is rewritten or annotated to reflect this inversion.
Sections that currently still read DB-first (notably parts of §3) are flagged
inline.

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

### 2.1 Domains

We own **two** domains: `nlqdb.com` and `nlqdb.ai`. We do **not** own `nlqdb.sh`.
To avoid SEO dilution and the "which one is real" confusion that kills brand
recall, we pick **one canonical**: everything lives on **`nlqdb.com`**.

**Hostname plan** (one row per public hostname, all under `.com`):

| Hostname | Purpose | Notes |
|---|---|---|
| `nlqdb.com` | Marketing site (Astro static, §3.1) | Primary entry. Carries all SEO weight. |
| `app.nlqdb.com` | Authenticated platform (§3.2) | Behind sign-in. No SEO concern. |
| `api.nlqdb.com` | HTTP API + MCP transport | Versioned `/v1/...`. |
| `elements.nlqdb.com` | CDN for `<nlq-data>` JS (§3.5) | Long-cache; served from R2 + Cloudflare. |
| `docs.nlqdb.com` | Documentation | Same Astro project, separate output. |

**`nlqdb.ai` strategy** — held as a brand asset, not split traffic:
- **Apex `nlqdb.ai`** — 301-redirect to `https://nlqdb.com/` (preserves any
  inbound links / typed traffic; consolidates ranking signal).
- **Optional `chat.nlqdb.ai`** — a memorable shortcut for the chat product
  (also 301 to `app.nlqdb.com/chat`). No SEO impact because it's behind auth.
  We use it in talks, t-shirts, social bios — places where short-and-memorable
  beats canonical.
- We secure `@nlqdb` on every relevant platform (GitHub org, npm scope,
  X, LinkedIn, Discord, Bluesky) so the brand-name story is consistent
  regardless of which TLD the user heard.

**Why `.com` not `.ai` as canonical:**
- `.com` is universally typeable, parses correctly in every email client,
  and avoids the "is .ai a TLD?" cognitive blip from non-tech users (P3
  Priya, P5 Aarav).
- `.ai` carries renewal-cost risk (~$60–80/yr vs `.com` ~$10–15/yr) and
  has historically had registry instability — bad fit for the `Domain`
  line in §7 we want to keep tiny and predictable.
- Holding `.ai` defensively prevents a competitor from squatting on the
  obvious AI-themed shortcut.

**Total fixed annual domain cost** (the only fixed cost we cannot avoid):
~$15 + ~$70 = **~$85/yr ≈ $7/mo amortized**. See §7.

---

## 3. Surfaces

### 3.1 Marketing site — `nlqdb.com`

The first thing the world sees. Built as a static-first **Astro** site (zero JS by default;
hydrate islands only when needed), so Lighthouse stays at 100/100/100/100 and the page
loads before the user blinks.

**Why Astro and not Next.js**: marketing pages are content. Astro ships ~0KB of JS by
default; Next.js ships React. We pay no React tax for a page that doesn't need React.
We use React/Svelte/Vue islands (`client:visible`) for the interactive demo only.

**Pages**:
- `/` — hero is **a single input box that asks "What are you building?"** (per
  §0.1). Placeholder cycles: *"a meal-planner for my partner"*, *"an agent
  that remembers my preferences"*, *"answer for the 4pm sync from this CSV"*,
  *"my CS50 final project"*. Pressing Enter does not navigate — the page
  morphs in place into a working chat (View Transitions API), the user's
  first reply streams in, and a DB has been silently created in the
  background. No "create your database" copy appears anywhere on this page.
  No signup wall.
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

### 3.2 Platform web app — `app.nlqdb.com`

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
- Install command: `curl -fsSL https://nlqdb.com/install | sh` installs the Go
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

**Surface (goal-first; see §0.1):**

```
nlq                                    # bare command → opens an interactive prompt:
                                       #   "What are you working on?" → creates DB silently,
                                       #   drops into chat REPL.

nlq new "an orders tracker"            # one-liner: creates DB derived from goal,
                                       # opens chat with the goal as the first message.

nlq "how many signups today"           # bare query against the *current* DB
                                       # (the most-recently-used; explicit and visible).

nlq login                              # device-code flow via Better Auth (browser).
nlq mcp install                        # auto-detects your MCP host(s) and sets them up.
                                       # Explicit form (`nlq mcp install claude`) is
                                       # the power-user override — see §3.4.
```

**Power-user surface (escape hatches, always available):**
```
nlq db create orders                   # explicit name when the user cares.
nlq db list
nlq query orders "..."                 # explicit DB targeting.
nlq chat orders                        # interactive REPL pinned to a DB.
nlq use orders                         # set default DB; visible in ~/.config/nlqdb/config.toml.
nlq connection orders                  # raw Postgres URL (escape hatch from §0).
```

The default-path commands (top block) cover ~95% of usage. The explicit-path
commands (bottom block) exist because power users are first-class — but they
are not the on-ramp.

**Auth flow** (per §0 "Seamless auth"; full spec in §4.3):

1. **Anonymous-first.** `nlq new "..."` and bare `nlq "..."` work with zero
   setup. The CLI mints an anonymous token (same 72h window as the web, §4.1)
   and caches it in the OS keychain under `nlqdb://anonymous`. The user gets
   an answer before being asked to sign in.
2. **Sign-in on adopt, not on first call.** On the first successful query the
   CLI prints one line: *"Saved as anonymous. Run `nlq login` within 72h to
   keep it."* — no prompt, no blocker. `nlq login` uses the **OAuth 2.0 Device
   Authorization Grant** against Better Auth:
   - CLI POSTs `/v1/auth/device`, receives `{ user_code, device_code,
     verification_uri_complete }`.
   - CLI opens the browser to `verification_uri_complete` — a URL that
     **already includes the code as a query param** (e.g.
     `https://nlqdb.com/device?code=ABCD-1234`). The user sees a single
     "Approve this device?" screen with one button. Zero typing.
   - The short user code is still printed to the terminal as a fallback in
     case the browser can't auto-open (SSH sessions, headless, etc.); in
     that case the user pastes it into `nlqdb.com/device` manually.
   On approval, the CLI polls `/v1/auth/device/token` and on success:
   - Adopts the anonymous DB(s) into the account (one row of SQL per §4.1).
   - Stores a **refresh token** (90d lifetime) in the OS keychain under
     `nlqdb://session/<email>`.
   - Caches a short-lived **access token** (1h, JWT) in-process only.
3. **Silent refresh.** Every HTTPS call attaches the access token. On `401
   token_expired`, the CLI transparently exchanges the refresh token for a new
   access token and retries the original request — once. The user never sees
   the 401.
4. **Re-auth recovery.** If the refresh token is revoked or expired, the next
   CLI invocation prints *"Session expired. Re-opening browser…"* and
   re-runs the device flow in-place, then resumes the original command. No
   lost keystrokes.
5. **`nlq logout`** wipes the keychain entry. `nlq whoami` prints the signed-in
   identity + device name + last-used timestamp.
6. **CI / headless mode.** `NLQDB_API_KEY=sk_live_...` takes precedence over
   any session; when set, `nlq login` is skipped entirely and no keychain
   access is attempted. This is the *only* env-var auth path — no bearer-token
   env var, no long-lived session file to copy.
7. **Credential storage is always the OS keychain** — `zalando/go-keyring` on
   all three platforms (Keychain / Credential Manager / libsecret). If the
   keychain is unavailable (e.g. a headless Linux box without a session bus),
   the CLI falls back to an AES-GCM-encrypted file at
   `~/.config/nlqdb/credentials.enc` keyed by a machine-bound key, and prints
   a one-line warning. Plaintext storage is never an option.

This makes the CLI's auth behavior indistinguishable from "no auth" on the
happy path and indistinguishable from "auth done right" on the bad path.

### 3.4 MCP server — `@nlqdb/mcp`

Distributed via `npx -y @nlqdb/mcp`. Same code path as the HTTP API — see
[`PLAN.md` §1.5](./PLAN.md). Tools exposed:
- `nlqdb_query(database, q)` — create-on-reference per §0.1, so there is no
  `nlqdb_create_database` tool on the default path.
- `nlqdb_list_databases()`
- `nlqdb_describe(database)` — returns inferred schema in NL

**Auth flow** (per §0 "Seamless auth"; full spec in §4.3 and §4.4):

The MCP server is a thin adapter over the HTTP API, so it never talks to
Postgres directly and never holds a database credential. Its only job is to
forward the caller's identity to `api.nlqdb.com`. Three installation paths,
all seamless:

1. **`nlq mcp install`** *(no arg — the default)*. Covers 95% of users. The
   CLI:
   a. Scans the known MCP-host config paths on this OS (list below) and
      prints what it found in one line: *"Found: Claude Desktop, Cursor.
      Not installed: Zed, Windsurf, VS Code, Continue."* Transparency is a
      core value — we never touch files the user didn't see us name.
   b. If **exactly one** host is found → installs to it silently.
      If **multiple** are found → prompts with a numbered list and installs
      to the selected one (or all via `--all`).
      If **none** are found → prints a one-line list of supported hosts with
      their install links and exits.
   c. If the user isn't signed in on this machine, triggers the `nlq login`
      device-code flow (§3.3) **before** touching any host config.
   d. Calls `POST /v1/keys` with `{ scope: "mcp", host: "<detected>",
      device_id: <hash-of-machine-id> }` to mint a **host-scoped API key**
      (`sk_mcp_<host>_...`, see §4.1). The key is never displayed — it's
      written directly to the host's config file at the correct path:
      - Claude Desktop: `~/Library/Application Support/Claude/config.json` (macOS),
        `%APPDATA%\Claude\config.json` (Windows), `~/.config/Claude/config.json` (Linux)
      - Cursor: `~/.cursor/mcp.json`
      - Zed: `~/.config/zed/settings.json`
      - Windsurf, VS Code, Continue: analogous per-host paths (same detection
        list hard-coded in the CLI).
   e. **Auto-reload when possible.** For hosts that watch their config (Cursor,
      Zed, Windsurf), the new server becomes available within seconds with no
      restart. For Claude Desktop (which doesn't hot-reload), the CLI detects
      whether the app is running and prompts: *"Restart Claude Desktop to
      activate? [Y/n]"* — on Y, it gracefully quits and re-launches the app.
   f. Validates the write by starting the MCP server once and issuing a
      self-check `nlqdb_list_databases()` call. Green check on success.
   g. **Total user-visible steps: one command, one browser approval (first
      time only), one restart prompt (Claude Desktop only). Nothing to type,
      nothing to remember.**
2. **Explicit host** `nlq mcp install <host>` *(power-user override)*.
   Skips auto-detection; targets the named host even if it's not installed
   (useful for pre-configuring machines). `<host>` ∈ {`claude`, `cursor`,
   `zed`, `windsurf`, `vscode`, `continue`}. Same auth/key/config steps as
   path 1.
3. **Website one-click install button** (for users who reach us via the web
   first). The button on `app.nlqdb.com/mcp` detects the user's platform,
   generates a host-scoped key server-side, and returns an
   `nlqdb://install?token=...&host=...` deep link. The locally-installed CLI
   (or a short-lived helper binary if the CLI isn't installed yet) handles
   the write. Same end state as path 1.
4. **Manual `NLQDB_API_KEY=...`** (CI, Docker, air-gapped). The env var is
   honored, takes precedence over any config file, and is the documented
   escape hatch. Users generate the key in the dashboard; the same `sk_mcp_`
   scoping rules apply.

**Key scoping and per-host isolation** (resolves the "same key for all agents"
concern — agents do **not** share credentials):

- Each `sk_mcp_<host>_<device>_...` key carries claims: `{ user_id, mcp_host,
  device_id, created_at, last_used_at }`. The dashboard lists every key with
  its host + device + last-used timestamp.
- DBs created through an MCP call are tagged with the key's `(mcp_host,
  device_id)` and are by default visible only to that host + device tuple
  under that user. A user can promote a DB to account-wide from the dashboard
  (one click), or pin a DB to a specific host.
- Revocation at the dashboard is instant: the next tool call returns `401
  key_revoked`, which the MCP server surfaces to the host LLM as a tool-use
  error that says *"Sign in again: run `nlq mcp install`."* The host
  prompts the user; re-install is a single command (auto-detects the host
  it was originally installed for).

**Transport auth**: the MCP server authenticates **to the API** with the
scoped key. It does **not** accept arbitrary inbound connections — it speaks
MCP over stdio to its host process only, which is the MCP security model.
There is no network listener on the user's machine.

**Downstream DB auth** (MCP → API → Postgres): the MCP server never sees a
Postgres connection string. The edge API in Workers owns the connection pool;
per-tenant credentials are derived from the caller's identity via a signed
internal JWT that never leaves the Cloudflare network. See §4.4.

One-click install buttons on the website for Claude Desktop, Cursor, Zed,
Windsurf, VS Code (all resolve to path 2 above).

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

**API keys**: separate from sessions. Three key types (not two — MCP scoping
is first-class):
- `pk_live_...` — publishable, browser-safe, **read-only**, per-DB,
  origin-pinned via the key's `allowed_origins` list. Used by `<nlq-data>`.
- `sk_live_...` — secret, server-only, full scope on the user's DBs. Used by
  backend services and the HTTP API. Rotated via dashboard or CLI.
- `sk_mcp_<host>_<device>_...` — secret, MCP-scoped; identical to `sk_live_`
  for query permissions but carries `(mcp_host, device_id)` claims used for
  per-host DB isolation (§3.4). One per host+device combination; revokable
  independently.

Keys are stored hashed (Argon2id). No plaintext key ever leaves the dashboard
after creation. The **last 4 characters** of every key are stored in
cleartext alongside the hash for display in the dashboard's key list
("sk_live_…a4f7 · last used 3m ago · Cursor on macbook-air").

### 4.2 Authorization model

Tiny on purpose:
- **Owner** — the user who created the DB. Full rights.
- **Member** — invited; read + query rights, no destructive ops, no key creation.
- **Public** — anonymous; read-only via publishable key, rate-limited.

That's the entire model in Phase 1. Roles/RBAC come in Phase 2 only if a paying
customer asks twice.

### 4.3 Session lifecycle across surfaces

One identity, projected onto four surfaces. Per the "Seamless auth" core
value (§0), the lifecycle is identical regardless of entry point — what
differs is only the front-end of the flow.

| Surface | Initial auth | Stored where | Access token TTL | Refresh |
|---|---|---|---|---|
| Web (`nlqdb.com`, `app.nlqdb.com`) | Magic link / passkey / GitHub / Google | `__Host-session` HttpOnly cookie (JWT) | 1h | Rotating refresh in KV, 30d sliding |
| CLI (`nlq`) | Device-code flow (`nlq login`) | OS keychain (refresh), in-memory (access) | 1h | 90d refresh, rotated on every use |
| MCP server | `nlq mcp install` (auto-detect) → scoped key per host | Host's config file (key only); no session | n/a (long-lived key) | Key rotation, not refresh |
| Embed element | `pk_live_` publishable key | Inline in HTML | n/a (long-lived key) | Key rotation, not refresh |

**The device-code flow** (used by `nlq login` and by the optional
"authenticate this terminal" flow for embed editing):

```
CLI                         API (Workers)                       Browser
 │                              │                                  │
 │─POST /v1/auth/device────────►│                                  │
 │                              │                                  │
 │◄─{user_code, device_code,────│                                  │
 │   verification_uri_complete, │                                  │
 │   interval}                  │                                  │
 │                              │                                  │
 │  open verification_uri_complete (code embedded in URL) ───────► │
 │  print user_code to terminal as fallback                        │
 │                              │◄─── user clicks "Approve" ───────│
 │                              │                                  │
 │─POST /v1/auth/device/token──►│                                  │
 │  (poll every `interval` s)   │                                  │
 │                              │                                  │
 │◄─{access_token, refresh_token,                                   │
 │   expires_in: 3600}──────────│                                  │
 │                              │                                  │
 │  write refresh_token to OS keychain                              │
 │  hold access_token in memory                                     │
```

The `verification_uri_complete` carries the `user_code` as a query param so
the approval screen has nothing to type — one click. The raw `user_code` is
still printed as a fallback for headless / SSH sessions where the CLI can't
open a browser.

**Refresh protocol** (shared by web and CLI, different storage):

```
any surface                  API
 │                            │
 │─call with access_token────►│
 │                            │
 │◄─ 401 token_expired ───────│
 │                            │
 │─POST /v1/auth/refresh─────►│  { refresh_token }
 │                            │
 │◄─{ access_token, refresh_token (rotated), expires_in }  (on success)
 │                            │
 │  retry original call, once (idempotent; see §0 invariants)
```

If refresh fails (`invalid_grant`), the surface **automatically re-initiates
the original flow** — the web app opens the sign-in page with a `return_to`
param; the CLI re-runs the device flow and resumes the original command.
The user never sees a bare 401.

**Revocation** is a write to the KV revocation set, keyed by `jti`
(JWT ID) for sessions and by key-hash-prefix for API keys. Edge checks
membership on every request; the check is free on cache hits and ≤2ms on
misses (KV read).

### 4.4 Service-to-service auth (how surfaces talk to each other)

The call graph in production:

```
[web browser | CLI | MCP client] ──► api.nlqdb.com (Workers edge)
                                            │
                                            │ signed internal JWT
                                            │ (includes user_id, db_id, scope)
                                            ▼
                            [Connection Pool | Plan Cache | LLM]
                                            │
                                            ▼
                            [Neon Postgres | Upstash Redis | …]
```

Rules (all bullet-proof-by-design per §9):

- **The edge is the only component that sees external credentials.** It
  terminates the `Authorization: Bearer ...` header, resolves the caller to a
  `(user_id, db_scope, rate_limit_bucket)` tuple, and signs a short-lived
  (30s) **internal JWT** using a Workers-only secret for all downstream calls.
- **No other component trusts the caller.** The LLM router, plan cache, and
  connection pool all verify the internal JWT's signature before acting. A
  leaked external key therefore has the blast radius of the key's scope —
  *never* the blast radius of the entire system.
- **The MCP server does not hold DB credentials.** It signs its outbound
  request to `api.nlqdb.com` with its `sk_mcp_...` key. It has no Postgres
  driver, no connection string, no way to bypass the edge. This is enforced
  structurally: the `@nlqdb/mcp` npm package has zero database-driver
  dependencies in its lockfile, and CI refuses to build it with any added.
- **The Postgres pool is at the edge, keyed by tenant.** Each user's DBs live
  on a per-tenant schema inside a shared Neon cluster. The internal JWT
  binds the caller to their schema via `SET LOCAL search_path` + Neon role
  scoping; there is no branch in app code that could "pick the wrong tenant"
  (per §9).
- **The embed element uses `pk_live_` keys only.** These keys are marked
  `read-only = true` and `origin-pinned = true` in D1; the edge rejects any
  mutating call that presents a publishable key, *before* the plan is
  generated. Writes from the browser must use `<nlq-action>`, which routes
  through a signed short-lived write-token issued after same-origin CSRF
  verification (Phase 2).

### 4.5 Key rotation, revocation, and device management

Seamless-auth (§0) requires this be instant and visible:

- **Dashboard → Keys** lists every active credential: `pk_live_…`, `sk_live_…`,
  every `sk_mcp_<host>_<device>_…`, plus every web session and every CLI
  device. Columns: type, host, device, created, last-used, IP (coarse),
  user-chosen label.
- **Revoke** is one click per row. Effect propagates in ≤2s (time to flip
  the KV revocation bit + edge cache invalidation). The affected surface
  gets `401 key_revoked` on its next call and enters the seamless re-auth
  path (§4.3) if it's a session, or surfaces a clear error if it's a
  dedicated key.
- **Rotate** (for `sk_live_` and `sk_mcp_`) issues a new key, marks the old
  one as deprecated (60d grace), and emits a webhook the user can wire into
  their deployment. CLI: `nlq keys rotate <id>`.
- **Global "sign everyone out"** is one click: invalidates all sessions, all
  device refresh tokens, and all `sk_mcp_` keys for the account. `sk_live_`
  and `pk_live_` keys are left alone (they're the user's own production
  credentials; rotate separately).
- **Email + in-app notification** on every key creation, every rotation,
  every revocation, every new-device sign-in. Template list in §5.1.
- **No plaintext-key retrieval path exists.** If the user lost their
  `sk_live_`, they rotate. We refuse to add a "reveal key" button because
  that's a store-plaintext foot-gun; refusing to build it is the feature.

---

## 5. Email, content & marketing

### 5.1 Transactional email — **Resend** (free tier: 3k/mo, 100/day)

- Magic links, password-less verification (we don't even have passwords, but
  email verification on first sign-in).
- Billing alerts ("you've used 80% of your monthly quota").
- Critical security alerts per §4.5 — one template each for: new-device
  sign-in (CLI or web), new MCP host registered, API key created, API key
  rotated, API key revoked, global sign-out.
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
| Domains | `nlqdb.com` (canonical) + `nlqdb.ai` (defensive, redirects to `.com`) | ~$85/yr total (`.com` ~$15 + `.ai` ~$70) — the only fixed cost | Required; not avoidable. See §2.1. |
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

### 8.1 Strict-$0 inference path (Day 1, before any credits)

The previous version of this section assumed Anthropic / OpenAI / Google
**startup credits** would arrive. Credits take days-to-weeks to be
approved, and a core value (§0) is that we ship without spending money. We
need a path that is $0 *with no credits and no card*. The 2026 free-tier
landscape makes this genuinely viable at our launch scale.

| Job | Strict-$0 provider | Free-tier limit (April 2026) | Card? |
|---|---|---|---|
| **Hot-path classification** | **Groq** — Llama 3.1 8B Instant | 30 RPM, 14,400 RPD, 6k TPM, 500k TPD | No |
| **NL → query plan** (workhorse) | **Google AI Studio** — Gemini 2.5 Flash | 10 RPM, 500 RPD, 250k TPM | No |
| **Hard-plan fallback** | **Google AI Studio** — Gemini 2.5 Pro | 5 RPM, 100 RPD | No |
| **Result summarization** | **Groq** — Llama 3.3 70B *or* Qwen3 32B | 30–60 RPM, 1,000 RPD | No |
| **Embeddings** | **Cloudflare Workers AI** — `@cf/baai/bge-base-en-v1.5` | 10,000 Neurons / day | No |
| **Universal fallback / dev/test** | **OpenRouter** — free models (`:free` suffix) | ~20 RPM, 200 RPD | No |
| **Local dev only** | **Ollama** (Llama 3.2 3B / Qwen 2.5 7B on the dev's laptop) | Unlimited locally | No |

**What this gives us at launch (rough math):**
- Free-tier ceiling is **~500 plan generations/day** (Gemini 2.5 Flash) +
  **~14,400 classifications/day** (Groq Llama 8B). After the plan cache
  (§5.1, target 60–80% hit rate) that translates to roughly **2,000–4,000
  user queries/day** before the first dollar leaves us.
- Embeddings free quota (10k Neurons/day on Workers AI, where one bge-base
  embedding ≈ 1 Neuron) covers schema-embedding refresh for **thousands of
  databases** before paying.
- This is enough to support our Phase 1 exit-criteria target ([`PLAN.md`
  §1.7](./PLAN.md): "median first-query latency < 2s, 5 paying customers")
  with headroom.

**Architecture rule (single config, swap providers without code changes):**
We route every LLM call through one tiny `llm/` adapter that takes a
`tier` (`classify | plan | summarize | hard | embed`) and a `provider_chain`
ordered by cost. Day 1 the chain for `plan` is
`[gemini_flash_free, groq_llama70b_free, openrouter_free, anthropic_paid]`.
Day 60 (after credits) we swap the order via a single env var. Day 365
(self-hosted) we prepend our own. **Zero application code changes** to
swap providers. The bullet-proof-by-design rule (§9) applies: providers
are interchangeable by construction.

**Honest constraints we accept on the strict-$0 path:**
- **Data privacy.** Free tiers (Gemini, Groq, OpenRouter free) **may use
  inputs to improve the provider's models.** This is **acceptable for
  free-tier users** (we tell them so plainly in our privacy policy).
  **Pro-tier customers are routed only through paid providers** with
  data-retention-off (Anthropic / OpenAI on paid tier, or self-hosted).
  This is the *only* meaningful free-tier feature reduction we accept,
  per §6, and it is a privacy upgrade, not a capability reduction.
- **RPM ceilings.** A burst of 12 simultaneous queries will queue. We add a
  small per-account token bucket and surface "queued — 2s" in the UI when
  it happens. Acceptable at our scale.
- **Provider availability.** Any single free provider can have a bad day.
  The provider chain (above) means a failure on Gemini falls through to
  Groq, then OpenRouter, with sub-100ms switch latency. We never depend
  on one free provider being up.
- **Geo.** Groq is US-only at the free tier. Gemini and Workers AI are
  global. Hot-path classification routing also has Workers AI Llama 3 as
  a backup so non-US first-byte latency stays under 1s.

**Account setup checklist** (live in [`IMPLEMENTATION.md`](./IMPLEMENTATION.md);
referenced here so the strict-$0 promise is testable, not aspirational):

1. Google AI Studio account → grab `GEMINI_API_KEY` (no card).
2. Groq Cloud account → grab `GROQ_API_KEY` (no card).
3. Cloudflare account → enable Workers AI, grab `CF_AI_TOKEN` (no card).
4. OpenRouter account → grab `OPENROUTER_API_KEY` (no card; only used as
   fallback).
5. Wire all four into the `llm/` adapter via env vars on Cloudflare Workers.

**Total cost to add intelligence to the entire product on Day 1: $0.**

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

1. Wire DNS for the domains we already own (`nlqdb.com`, `nlqdb.ai`) per §2.1.
   Park the Astro hero with the live demo on `nlqdb.com`; apex-redirect
   `nlqdb.ai` → `nlqdb.com`. Open-source the repo on day 1. Apply for
   Anthropic, OpenAI, Google startup credits (and meanwhile run on the
   strict-$0 inference path in §8.1).
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

## 13. Reusable CI/CD — GitHub Actions

We are an OSS-first dev-tools company shipping multiple repos on the same
release cadence (web, platform, CLI, MCP, elements, SDKs, infra). Every repo
needs the same handful of jobs: lint, type-check, test, build, security
scan, release. We refuse to copy-paste workflow YAML into 8 repos.

**Design choice:** **one** repo (`nlqdb/.github` — actually a normal
`nlqdb-actions` repo because GitHub's `.github` repo can't host reusable
workflows for a private org) owns:

1. A **reusable workflow** (`.github/workflows/ci.yml`) callable from any repo
   via `uses: nlqdb/actions/.github/workflows/ci.yml@v1`. This handles the
   full pipeline (lint → typecheck → test → build → scan → optional release).
2. A small set of **composite actions** (`actions/setup-node`, `actions/setup-go`,
   `actions/cache-restore`, `actions/llm-changelog`) for steps that vary
   across language stacks but follow the same pattern.

**Why reusable workflows instead of just composite actions:** reusable
workflows can carry their own `permissions:`, `concurrency:`, matrix, and
secrets — composites cannot. We get one source of truth for the *whole*
pipeline, not just steps.

**Why one tag (`@v1`), not `@main`:** a moving target across 8 repos breaks
8 repos at once. We tag (`v1`, `v1.1`, …) and only `@v1` major-bump on
intentional breaking changes.

### 13.1 Repository layout (`nlqdb/actions`)

```
nlqdb/actions/
├── .github/
│   └── workflows/
│       ├── ci.yml              # the reusable CI pipeline
│       └── release.yml         # the reusable release pipeline (semver, npm, brew, GH releases)
├── actions/
│   ├── setup/
│   │   └── action.yml          # auto-detects node/go/python; installs + caches
│   ├── llm-changelog/
│   │   └── action.yml          # composes a changelog using a tiered LLM call
│   └── deploy-cloudflare/
│       └── action.yml          # wraps wrangler deploy with our conventions
├── README.md
└── CHANGELOG.md
```

### 13.2 The reusable CI workflow

Per [§0 core values] this must be: simple, fast, bullet-proof by design.
Concretely:

- **One file**, one entry point.
- **Auto-detects** the language from the consumer repo (presence of
  `package.json`, `go.mod`, `pyproject.toml`). No manual `language:` input.
- **Concurrency-safe**: cancels in-progress runs on the same ref so PR
  pushes don't queue.
- **Cached aggressively**: pnpm store, Go build cache, Turborepo remote
  cache (free tier on Vercel, but optional).
- **Matrix is implicit**: only one OS (Ubuntu) and one runtime version per
  language by default. We do not waste minutes on matrix combinatorics
  unless the consumer opts in via `matrix-os:` and `matrix-versions:`.
- **Fast-fail order**: lint < typecheck < test < build < scan. Cheapest
  signal first.
- **Free-tier compliant**: GitHub Actions is free for public repos (which
  ours are), so this costs $0/month — see §7.

```yaml
# nlqdb/actions/.github/workflows/ci.yml
name: nlqdb-reusable-ci

on:
  workflow_call:
    inputs:
      package-manager:
        description: "pnpm | npm | yarn | bun | go | uv (auto-detected if blank)"
        required: false
        type: string
      run-release:
        description: "Run the release job on push to main if this repo is publishable"
        required: false
        default: false
        type: boolean
      matrix-os:
        required: false
        default: '["ubuntu-latest"]'
        type: string
      matrix-versions:
        required: false
        default: '[""]'   # blank = use repo's lockfile / go.mod / .python-version
        type: string
    secrets:
      NPM_TOKEN:           { required: false }
      CLOUDFLARE_API_TOKEN:{ required: false }
      ANTHROPIC_API_KEY:   { required: false }   # used by llm-changelog
      CODECOV_TOKEN:       { required: false }

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write
  id-token: write          # for OIDC publish to npm / Cloudflare

jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      lang: ${{ steps.detect.outputs.lang }}
    steps:
      - uses: actions/checkout@v4
      - id: detect
        uses: nlqdb/actions/actions/setup@v1
        with:
          package-manager: ${{ inputs.package-manager }}

  lint:
    needs: detect
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nlqdb/actions/actions/setup@v1
      - run: |
          case "${{ needs.detect.outputs.lang }}" in
            node) pnpm lint ;;
            go)   golangci-lint run ./... ;;
            py)   ruff check . ;;
          esac

  typecheck:
    needs: detect
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nlqdb/actions/actions/setup@v1
      - run: |
          case "${{ needs.detect.outputs.lang }}" in
            node) pnpm typecheck ;;
            go)   go vet ./... ;;
            py)   pyright ;;
          esac

  test:
    needs: [detect, lint, typecheck]
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: true
      matrix:
        os: ${{ fromJSON(inputs.matrix-os) }}
        version: ${{ fromJSON(inputs.matrix-versions) }}
    steps:
      - uses: actions/checkout@v4
      - uses: nlqdb/actions/actions/setup@v1
        with:
          version: ${{ matrix.version }}
      - run: |
          case "${{ needs.detect.outputs.lang }}" in
            node) pnpm test --coverage ;;
            go)   go test -race -coverprofile=coverage.out ./... ;;
            py)   pytest --cov ;;
          esac
      - if: secrets.CODECOV_TOKEN != ''
        uses: codecov/codecov-action@v5
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nlqdb/actions/actions/setup@v1
      - run: |
          case "${{ needs.detect.outputs.lang }}" in
            node) pnpm build ;;
            go)   go build ./... ;;
            py)   python -m build ;;
          esac
      - uses: actions/upload-artifact@v4
        with:
          name: build-${{ github.sha }}
          path: dist/
          retention-days: 7

  scan:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          exit-code: '1'
          severity: HIGH,CRITICAL
          ignore-unfixed: true
      - uses: github/codeql-action/init@v3
      - uses: github/codeql-action/analyze@v3

  release:
    if: inputs.run-release && github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: nlqdb/actions/actions/setup@v1
      - uses: nlqdb/actions/actions/llm-changelog@v1
        with:
          model: claude-sonnet-4.6      # per §8 cost-control
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
      - run: pnpm changeset publish
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 13.3 Consumer usage (every repo, one file each)

```yaml
# nlqdb/cli/.github/workflows/ci.yml      ← copy-paste this 4-line file into every repo
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  ci:
    uses: nlqdb/actions/.github/workflows/ci.yml@v1
    with:
      run-release: true
    secrets: inherit
```

That's the entire CI for any nlqdb repo. Four lines. Per §0: simple, fast,
bullet-proof by design.

### 13.4 Release pipeline (separate reusable workflow)

We keep CI and release in the same file when small (above). For the
platform repo, which deploys a website on every merge, we additionally call
`nlqdb/actions/.github/workflows/deploy-cloudflare.yml@v1` from a
`deploy.yml` workflow. Same pattern: four-line consumer, all logic
upstream.

### 13.5 Conventions enforced by CI (so they don't need a docs page)

- Conventional Commits required (enforced by a commit-lint job in `lint:`).
- `CHANGELOG.md` is generated, not hand-written (via `llm-changelog` action,
  which uses Sonnet 4.6 per §8).
- Semver: `changesets` for npm packages; tag-driven for Go binaries; auto
  PR for version bumps.
- Every PR gets a sticky comment with: build size delta, test coverage
  delta, p95 benchmark delta (where applicable), and a link to the preview
  deploy.

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

### 15.5 The pattern across all four

Across every persona, the **first action is stating a goal**. The DB is a
silent consequence. The product surfaces (chat, CLI, MCP, embed) are four
projections of the same one verb: *ask, in plain English, against the
data you care about*. Sections of the design that fight this rule are
flagged in §0.1 and amended above.

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
