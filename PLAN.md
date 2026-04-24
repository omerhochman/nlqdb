# nlqdb — Natural Language Database

> A database you talk to. Create one, query it in English, done.
> Infrastructure is invisible. It Just Works™, and if it doesn't we rebuild it behind the scenes before you notice.

---

## 0. Product Thesis

The existing "text-to-SQL" world is a toy layer on top of a DB the user still has to choose, provision, model, index, back up, scale, and migrate. That is not a product — that is homework.

**nlqdb inverts it.** The user performs exactly two actions:

1. Create a database. (One word: a name.)
2. Talk to it. (Free-form natural language — insert, query, update, analyze.)

Everything else — engine choice (Postgres vs Mongo vs Redis vs DuckDB vs SQLite vs a vector store), schema inference, indexing, sharding, replication, backups, migration between engines, cost optimization — is a background concern the user never has to see unless they want to.

The product must feel **simpler than Vercel**. Vercel still makes you pick a framework. We don't even make you pick a data model.

### Non-negotiables

- **Zero config to first query.** From landing page to first answer in under 60 seconds, no credit card.
- **No schema wall.** The user never sees `CREATE TABLE` unless they ask for it.
- **Honest latency.** If the answer takes 4s because we're auto-migrating underneath, we show a live trace — we don't lie with spinners.
- **Escape hatch.** Power users can drop to raw SQL / raw Mongo / raw connection string at any time. Hidden ≠ locked.
- **Correctness over cuteness.** A wrong answer in confident English is worse than "I'm not sure — here are three interpretations."

---

## Phase 1 — The Surface (Onboarding, API, CLI, MCP)

**Goal of Phase 1:** ship the experience before the engine. The backend in Phase 1 is a thin shim — one shared Postgres + an LLM. We are buying the right to iterate on UX with real users.

**Scope:** just two actions end-to-end across four surfaces.

```
create_database(name)           -> returns a db handle + API key
query(db, "natural language")   -> returns rows + a natural-language answer + a trace
```

Nothing else exists yet. No users table, no teams, no billing UI (Stripe checkout link only), no dashboards beyond the one we need.

### 1.1 Onboarding UX — the 60-second path

The entire onboarding is a single page. No wizard. No email verification wall before first query.

1. **Landing** — one input box: "Name your database." Example placeholder cycles: `orders`, `users`, `telemetry`, `coffee-shop`.
2. **Enter key** — the DB is created instantly. We do *not* redirect. The input box morphs into a chat. Above it, a subtle line: `orders.nlqdb.com · ready`.
3. **First query prompt** — ghost text suggests: `try "add a customer named Alice who ordered 2 lattes"`. The user types anything. We answer.
4. **Sign-in happens after value.** After the first successful query, a slim bar appears: "Save this DB — sign in with GitHub / Google / magic link." If they leave, the DB survives 72h under an anonymous token stored in localStorage.
5. **On sign-in**, we reveal (progressively, not all at once):
   - API key + one-line curl snippet
   - CLI install command (one line, copy button)
   - MCP endpoint URL
   - A "Connection details" disclosure that reveals the *actual* underlying connection string (Postgres URL in Phase 1). Clicking it is a conscious act.

**Explicit anti-patterns we refuse:**
- Multi-step wizards.
- "Choose your plan" before first query.
- Email verification before first query.
- Dark patterns around free trial expiry (no auto-charge without a second explicit confirmation — see §5).
- Modals that interrupt the chat.
- A "getting started" video. If we need one, we failed.

### 1.2 The chat interface — design principles

The chat is the product. It must be better than a generic LLM wrapper.

- **Every response has three parts**, collapsible: *answer* (prose), *data* (table/JSON, if any), *trace* (the SQL/Mongo query we actually ran + which engine + latency). Trace is collapsed by default but always present. This builds trust over time and gives power users what they want.
- **Streaming.** Tokens stream. Rows stream when they arrive. Never a dead 3-second spinner.
- **Ambiguity is surfaced, not guessed.** If "top customers" could mean by revenue or by count, we ask inline with clickable chips — not another chat turn.
- **Re-run & edit.** Every query is editable in place; re-running updates in place.
- **Undo.** Destructive actions ("delete all users from Germany") show a diff preview first and require a second Enter to execute. This is a hard rule, not a setting.
- **History is a first-class object.** Left rail lists queries; each one is permalinkable and shareable (with the data redacted by default — sharing data requires an explicit click).
- **Multi-DB in one window.** Tab-like switcher at the top. `@orders` prefix in the prompt to route one-off queries.
- **Keyboard-first.** `Cmd+K` command palette for everything. `↑` to edit the last query. `Cmd+Enter` to run. `Cmd+/` to toggle trace.

### 1.3 The API — the Vercel-simpler target

```http
POST https://api.nlqdb.com/v1/databases
Authorization: Bearer <key>
{ "name": "orders" }

-> 201 { "id": "db_...", "name": "orders", "endpoint": "https://api.nlqdb.com/v1/db/db_..." }
```

```http
POST https://api.nlqdb.com/v1/db/{id}/query
Authorization: Bearer <key>
{ "q": "how many orders last week, by country" }

-> 200 {
  "answer": "Germany: 412, US: 387, ...",
  "data":   [ {"country":"DE","count":412}, ... ],
  "trace":  { "engine": "postgres", "sql": "SELECT ...", "ms": 83 }
}
```

That's the entire public surface in Phase 1. Two endpoints. **No SDK is required** — `fetch` is the SDK. We ship SDKs (TS, Python, Go) because people expect them, but the API is small enough to be memorized.

Design rules for the API:

- **Stable idempotency.** `Idempotency-Key` header on every mutating call. We mean it.
- **Errors are a payload, never just a status.** `{ "error": { "code": "AMBIGUOUS_QUERY", "suggestions": [...], "trace_id": "..." } }`
- **Streaming via SSE** on `/query` when `Accept: text/event-stream`.
- **No versioning drama.** `/v1` forever; additive-only. We version the *interpretation* (query model ids) separately.
- **Server-sent trace.** Same trace the UI shows is returned in the API response — no hidden info asymmetry between surfaces.

### 1.4 CLI

Install: `curl -fsSL https://nlqdb.com/install | sh` (a single static binary — Go or Rust; see alternatives §4).

```
nlq login
nlq db create orders
nlq query orders "how many signups today"
nlq chat orders            # interactive REPL, streams like the web UI
nlq connection orders      # prints the underlying connection string (explicit escape hatch)
```

CLI UX rules:
- `nlq` with no args drops into an interactive picker (like `gh`).
- Output is human-formatted by default; `--json` for scripts. No surprise TTY detection breakage — explicit flag wins.
- Every command takes a DB positional. No hidden "current database" state unless the user runs `nlq use orders`, which writes to `~/.config/nlqdb/config.toml` and is visible.
- `nlq query ... --explain` shows the trace inline.

### 1.5 MCP server

We ship an MCP server from day one because LLM agents *are* the second user.

Tools exposed:
- `nlqdb_query(database, q)` → `{ answer, data, trace }` — creates the DB on
  first reference per [`DESIGN.md` §0.1](./DESIGN.md), so no public
  `nlqdb_create_database` tool.
- `nlqdb_list_databases()` → list
- `nlqdb_describe(database)` → inferred schema in NL

The MCP server is the same code path as the HTTP API — not a parallel implementation. It's a thin adapter with **no database driver in its dependency tree** (enforced by CI, per [`DESIGN.md` §4.4](./DESIGN.md)).

**Auth** is a first-class part of the MCP surface, not an afterthought. Full spec in [`DESIGN.md` §3.4, §4.3, §4.4](./DESIGN.md). Summary:

- Install path: `nlq mcp install` (no arg) — one command that auto-detects installed hosts on this OS, runs the CLI device-code sign-in if needed, mints a host-scoped `sk_mcp_<host>_<device>_…` key per host, patches the host's config file, and offers to restart Claude Desktop if it's running. Explicit form `nlq mcp install <host>` remains as the power-user override.
- Per-host, per-device isolation: each host gets its own key and its own DB namespace by default — agents do **not** share credentials.
- `NLQDB_API_KEY` env var remains the escape hatch for CI / air-gapped boxes.

Install: `nlq mcp install` (auto-detect) is the default; `npx -y @nlqdb/mcp` remains for users who want to wire things manually; website one-click install buttons handle the sign-in in-browser.

### 1.6 Phase 1 backend (the shim)

Keep it embarrassingly simple. This is not the product yet.

- **One shared Postgres** (managed: Neon or Supabase free tier). Every user DB is a Postgres schema. No per-user VMs.
- **LLM layer:** Claude (primary) with a structured tool-use loop. The loop: parse intent → resolve schema context from pgvector embeddings of table/column names → emit SQL → execute → summarize. See §3 for the robust version.
- **Schema inference on write.** First insert creates columns. Types are inferred and *widened* over time, never narrowed without an explicit migration.
- **Auth:** **Better Auth** (TypeScript, OSS, MIT). Full rationale in [`DESIGN.md` §4](./DESIGN.md); short version — no per-MAU pricing cliff, OSS-to-OSS alignment, TypeScript types shared with our Drizzle schema. This revises the Phase-0 draft that named Clerk/WorkOS. Methods: magic link, passkey, GitHub OAuth, Google OAuth. Not Auth0 (pricing cliff). Not roll-our-own (auth is not a wheel we reinvent — we use the library, we own the UI). Device-code flow for the CLI and MCP install is first-class, not a bolt-on — see [`DESIGN.md` §4.3](./DESIGN.md).
- **Rate limits:** per-API-key token bucket in Redis (Upstash — free tier, HTTP API, no persistent connections).
- **Observability:** trace IDs propagate across UI → API → LLM → DB. One OTEL collector, ship to Grafana Cloud free tier in Phase 1.

### 1.7 Phase 1 exit criteria

- Median first-query latency < 2s, p95 < 5s.
- 60-second onboarding validated with 20 unstructured user tests.
- Five paying customers who say "I'd be sad if this went away."
- MCP server installed in ≥ 3 distinct client apps in the wild.
- Zero support tickets about "how do I create a table" — if we get any, the onboarding has failed.

---

## Phase 2 — The Engine (invisible infrastructure)

**Thesis:** the user's queries are the source of truth for what the database *should be*. A workload that is 99% point lookups by id should be in Redis. A workload that is 80% range scans + joins should be in Postgres. A workload that is ragged document-shaped should be in Mongo (or a JSONB Postgres if we can help it). An analytics workload should be in DuckDB / ClickHouse. A semantic-search workload needs pgvector or a dedicated vector store.

**The engine continuously reads the query log and picks — and changes — the backend without downtime.**

### 2.1 Architecture overview

```
                    ┌─────────────────────────┐
  user query ──►    │  Query Planner (LLM +   │ ──► engine-specific executor
                    │  learned router)        │        │
                    └────────────┬────────────┘        │
                                 │                     ▼
                                 ▼               ┌────────────────────────┐
                         ┌───────────────┐       │  Engines (per-db):     │
                         │ Query Log     │◄──────│  PG │ Mongo │ Redis │  │
                         │ (append-only) │       │  DuckDB │ pgvector │  │
                         └──────┬────────┘       └──────────┬─────────────┘
                                │                           │
                                ▼                           │
                      ┌──────────────────┐                  │
                      │ Workload Analyzer│ ─── decision ──► Migration Orchestrator
                      │ (background)     │                  │
                      └──────────────────┘                  ▼
                                                     ┌───────────────┐
                                                     │ Shadow + Cutover│
                                                     └───────────────┘
```

### 2.2 Core components

#### Query Planner
- Given NL query + current engine + schema snapshot, emits a typed plan.
- Hybrid: cached template router (fast path for repeat-structure queries) + LLM fallback (cold path).
- Returns a *confidence score*; low confidence triggers the inline clarification chips from §1.2.
- Plans are content-addressed and cached per-schema-hash.

#### Execution layer
- One adapter per engine. Common `Executor` interface: `execute(plan) -> stream<row>`.
- We own the connection pool per user-DB. PgBouncer-style, but ours — see §6.

#### Query Log (workload fingerprint)
- Every query writes: fingerprint, latency, rows scanned, rows returned, engine used, plan shape (point-get / range / agg / join / doc-traversal / full-text / vector / graph-walk).
- Fingerprints are anonymized; the *shape* is stored, not the data.
- Storage: the query log itself is a Postgres + ClickHouse combo (hot in PG, cold in CH).

#### Workload Analyzer
- Runs every N minutes per DB.
- Classifies the workload distribution into a vector over engine affinities.
- Emits a recommendation: `{ current: pg, recommended: redis+pg, confidence: 0.87, reason: "92% of queries in last 24h are point-lookups by primary key with <1KB values" }`.
- Never auto-migrates on its own decision alone — requires (a) confidence > threshold, (b) sustained over a window (hours, not minutes), (c) projected cost/latency win > threshold.

#### Migration Orchestrator
- **Shadow-writes** to the new engine while reads stay on the old one.
- Backfill in parallel; throttled against current load.
- **Dual-read verification** — a sample of production reads runs on both engines and we compare results. Any divergence blocks cutover and pages.
- **Atomic cutover** via a per-db routing pointer. Rollback is a pointer flip.
- The user sees a single subtle line in their trace: `engine: postgres → redis (migrated 2h ago)`. Nothing more, unless they ask.

#### Backup & restore
- Continuous WAL-style backup per engine to object storage (R2 primary — cheapest egress; S3 secondary).
- Point-in-time restore to any second in last 7 days on free tier, 30 days on paid.
- Restore is a natural-language action too: "restore orders to yesterday 3pm". Yes, really.

### 2.3 Engine selection heuristics (starting point, will be learned)

| Workload signature | Engine |
|---|---|
| Majority writes + point reads by id, small values | Redis (persistence on) |
| Relational joins, constraints, strong consistency | Postgres |
| Document-shaped, variable schema, deep nesting | Mongo *or* Postgres JSONB (prefer JSONB unless nesting > 4 levels and access is by nested path) |
| Analytics, scans, aggregations over millions of rows | DuckDB (embedded) or ClickHouse (managed, at scale) |
| Semantic search, embeddings | pgvector (default) → Qdrant (if corpus > ~10M vectors) |
| Time-series append-heavy | TimescaleDB extension on PG |
| Full-text search heavy | PG `tsvector` default → Typesense at scale |
| Graph traversals (>3 hops common) | Postgres recursive CTE default → Neo4j only if truly graph-native workload |

**Principle:** default to Postgres + extensions. Only move off Postgres when the evidence is overwhelming. "Postgres for everything" is the boring correct answer 80% of the time, and we should honor that.

### 2.4 Multi-tenancy & isolation

- **Phase 2a (early):** Postgres schema-per-DB on shared clusters. Row-level-security off, we rely on connection-level scoping.
- **Phase 2b (scale):** tier-based tenancy — free + hobby share clusters; pro+ get dedicated compute (Neon branches, Fly Machines, or our own k8s). The user never sees this shift.
- **Noisy neighbor mitigation:** per-DB query timeouts, per-DB memory caps, per-DB connection caps, all enforced at the proxy.

### 2.5 Phase 2 exit criteria

- Auto-migration between at least PG ↔ Redis and PG ↔ DuckDB running in prod with zero user-visible downtime across 100+ migrations.
- Workload Analyzer's decisions beat a human DBA on a held-out benchmark (we'll build it).
- p99 query latency under the *current* engine is within 1.3× of hand-written queries against that engine directly. We pay some tax for abstraction, not a 10× tax.
- Backups: verified restore drill passes weekly. We don't trust untested backups.

---

## 3. The LLM loop, honestly

This is the part most people get wrong. A single "prompt → SQL → run" pipeline is a demo, not a product.

Our loop, per query:

1. **Schema retrieval.** Embed table + column names + sample values + foreign keys. Retrieve top-K relevant objects. Cache per schema hash.
2. **Intent classification.** Read / write / ambiguous / clarification-needed / out-of-scope. Cheap model.
3. **Plan generation.** Structured tool-use with the target engine's grammar as a constrained decode where possible (grammars for SQL exist; for Mongo aggregation we hand-roll).
4. **Static validation.** Parse the plan. Check referenced columns exist. Check destructive ops. Dry-run with `EXPLAIN` when cheap.
5. **Confidence gate.** If confidence is low OR the plan is destructive OR touches > N rows, surface a confirmation in the UI and a `requires_confirm: true` in the API response.
6. **Execute + stream.**
7. **Summarize.** Cheap model turns rows into prose. Always attach raw data too — we do not paraphrase away the truth.
8. **Log.** Fingerprint to workload log. Store {q, plan, latency, rows, engine} for the Workload Analyzer.

**Reinventions we are willing to do here (see §6):**
- Our own grammar-constrained SQL decoder tuned to each dialect.
- Our own schema-embedding format (not just `text-embedding-3`) that treats foreign keys as edges.
- A learned query-shape classifier that runs in <10ms on the hot path, beats "just ask the LLM" on latency, and hands off to the LLM when unsure.

---

## 4. Alternative technologies — evaluated, not just listed

We lean toward tools with **real APIs, generous free tiers, and no mandatory UI step**. UI-first vendors are disqualified — we cannot automate them.

### Underlying data engines

| Candidate | Verdict | Notes |
|---|---|---|
| **Postgres (Neon)** | ✅ primary | Branching = migration-friendly; serverless; generous free tier; HTTP API; cold starts acceptable. |
| **Postgres (Supabase)** | ⚠️ backup | Great DX but opinionated (auth, storage bundled) which conflicts with our own stack. |
| **Postgres (RDS/Aurora)** | ❌ Phase 2 only, at scale | Slow to provision via API, expensive idle. |
| **Postgres (self-hosted on Fly.io machines)** | ✅ considered | Full control, cheap, API-provisionable. Heavier on us operationally. |
| **SQLite (Turso / libSQL)** | ✅ for edge + small DBs | Embedded-ish, replicated, HTTP API, very cheap. Great fit for hobbyist DBs in free tier. |
| **DuckDB** | ✅ analytics | Embedded OLAP. We run it as a sidecar for analytic workloads on a user's PG data via the `postgres_scanner` extension. |
| **MongoDB Atlas** | ⚠️ | Good API. Free tier is tiny. Prefer JSONB on PG unless we must. |
| **Redis (Upstash)** | ✅ | HTTP API — no persistent conns, serverless-friendly. The right Redis for us. |
| **Redis Cloud / ElastiCache** | ❌ phase 1 | Needs persistent conns; bad fit for serverless. |
| **ClickHouse Cloud** | ✅ Phase 2 analytics-at-scale | Solid API. |
| **Qdrant Cloud** | ✅ vector scale | API-first. |
| **pgvector** | ✅ default vector | Keeps us in PG. |
| **TimescaleDB** | ✅ time-series default | PG extension — no new engine. |
| **Typesense / Meilisearch** | ✅ optional search | API-first. |
| **Neo4j Aura** | ⚠️ | Only if workload is truly graph. |
| **FaunaDB** | ❌ | Cute but vendor-lock and pricing opacity. |
| **PlanetScale** | ❌ post-Vitess-changes | Evaluate again later. |
| **CockroachDB** | ⚠️ | Great at scale; expensive early. Phase 3. |

### Hosting / compute

| Candidate | Verdict | Notes |
|---|---|---|
| **Cloudflare Workers + R2 + D1** | ✅ edge + cheap egress | R2 has no egress fees — huge for us (backups, data streams). D1 as a hobby-tier primary. |
| **Fly.io Machines** | ✅ primary compute | API-first, per-second billing, close to Postgres. |
| **Vercel** | ✅ frontend only | Not for stateful workloads. |
| **Railway** | ⚠️ | Good API but pricing at scale is unclear. |
| **AWS (raw)** | ❌ phase 1 | Too heavy, too slow to iterate. Revisit in Phase 3 for enterprise. |
| **Render** | ⚠️ | OK but not cheaper than Fly. |
| **Modal** | ✅ for the LLM workers | Great Python API, scales to zero. |

### Auth

| Candidate | Verdict |
|---|---|
| **Clerk** | ✅ Phase 1 — best DX, real API |
| **WorkOS AuthKit** | ✅ alt, better for enterprise SSO later |
| **Supabase Auth** | ❌ pulls in whole Supabase |
| **Auth0** | ❌ pricing cliff |
| **Roll our own** | ❌ not now |

### Payments

| Candidate | Verdict |
|---|---|
| **Stripe** | ✅ default, metered billing native |
| **Lago (self-hosted)** | ✅ usage metering layer in front of Stripe — open source, API-first |
| **Orb** | ✅ alt metering if Lago doesn't scale |
| **Paddle** | ⚠️ MoR model is nice for int'l sales tax but more restrictive |

### LLM providers

| Candidate | Verdict |
|---|---|
| **Anthropic (Claude)** | ✅ primary — reasoning + tool use quality |
| **OpenAI** | ✅ fallback + cheap-small-model tier |
| **Together / Groq / Fireworks** | ✅ for the cheap classifier models (latency wins) |
| **Local (Llama 3.x via vLLM on our Fly boxes)** | ✅ for the schema-embedding + hot-path classifier — not for plan generation |

### Observability

- **Grafana Cloud free tier** + OTEL — good enough until we outgrow it.
- **Sentry** for app errors.
- **Self-hosted Loki** later.

### MCP

- Official MCP TypeScript SDK for the server.
- Publish to `npm` as `@nlqdb/mcp`.

---

## 5. Costs & payment — the serious conversation

This section is long on purpose. Pricing is a product decision, not a finance decision.

### 5.1 Our cost structure (rough model per active DB, Phase 1)

| Line item | Source | Notes |
|---|---|---|
| Storage | Neon / Turso / R2 | ~$0.10–0.25/GB-mo — essentially free for typical user DB (<100MB). |
| Compute idle | Neon scale-to-zero / Fly Machines stop | We MUST use scale-to-zero infra or costs explode. |
| Compute active | Fly / Neon | Pay per second of actual query activity. |
| LLM inference | Anthropic / OpenAI / Together | **This is our largest variable cost.** Dominates the unit economics. |
| Egress | Cloudflare R2 | Zero. This is why R2. |
| Observability | Grafana free tier | Zero until we scale. |
| Auth | Clerk free tier (< 10k MAU) | Zero early. |

**The LLM cost is the thing.** Every query is one expensive call (plan gen) + one cheap call (summarize) + some embeddings. A naïve implementation costs us $0.005–$0.02 per query. At 1000 queries/user/month, that's $5–$20/user/mo in pure inference — before anything else.

Mitigations, in priority order:
1. **Plan cache by fingerprint.** Repeat queries bypass the LLM entirely. Realistic hit rate: 60–80% for mature user workloads.
2. **Small-model first, big-model on fallback.** Cheap classifier (Haiku / GPT-4o-mini / local Llama) handles the easy 70%; Sonnet/Opus only for ambiguous or complex plans.
3. **Batch embeddings** — schema embeddings are generated once per schema, not per query.
4. **No summarization for structured-output API calls** — the summary step is skipped when the client wants raw data.
5. **Local models for the hot path** — once we have enough traffic to amortize a GPU, self-host the classifier.

### 5.2 Pricing the user will see

Three-tier is a cliché for a reason. Keep it.

**Free (no card required)**
- Unlimited DBs (soft cap on size per DB, e.g. 500MB).
- 1,000 queries / month.
- 7-day backup retention.
- Community support.
- DBs pause after 7 days of no activity, resume instantly on next query (cold start < 2s).

**Hobby — $10/mo (or $0 if you sign up via GitHub student/OSS)**
- 50,000 queries / month.
- 30-day backup retention.
- No pausing.
- Email support.

**Pro — usage-based, starts at $25/mo minimum**
- Metered by (a) queries, (b) storage-GB-mo, (c) LLM tokens on complex queries (transparently shown).
- Dedicated compute once you cross a threshold.
- 30-day PITR.
- Priority support.

**Enterprise** — custom. VPC peering, SSO, audit log export. Annual contract.

### 5.3 The trial experience — no dark patterns

Hard rules:

- **No credit card for free tier, ever.** Not "to verify identity." Not "for spam protection." No.
- **The trial is the free tier itself.** There is no separate "14-day Pro trial" with a countdown. When a user exceeds free limits, we **do not charge them** — we rate-limit with a clear message: "You've used your 1000 queries. Add a card to continue — or wait until next month." The user's data is never held hostage. Export is one click, always free.
- **First charge confirmation.** When a card is added, the first month is a one-time confirmation — we email ("You'll be billed $X on Y. Reply NO to cancel."). No silent auto-upgrades from Hobby to Pro; tier changes are a deliberate click.
- **Usage predictability.** Hard caps on Pro are opt-in but default to a *soft* cap: at 80% of a user-set monthly budget we email; at 100% we email and require a one-click extension. No surprise $4,000 bills. Ever.
- **Downgrade is as easy as upgrade.** One click. Pro-rated refund on the unused portion.
- **Cancellation is one click** and does not require a call, a chat, or an exit survey. Optional exit survey *after* cancellation is fine.

### 5.4 Payment tech stack (API-first, low overhead)

- **Stripe Billing** for invoicing + payment method capture.
- **Lago** (self-hosted, open source) in front of Stripe for usage metering. Meters queries, tokens, GB-mo. Emits invoice events to Stripe.
- **Checkout is Stripe-hosted.** Don't build card forms. Every hour we spend on a card form is an hour not spent on the product.
- **Tax** — Stripe Tax enabled from day 1. It Just Works.
- **International** — Paddle as an optional Merchant of Record if we expand before setting up entities abroad.

### 5.5 Keeping early-user costs near zero (for us)

- Neon free tier: 0.5GB, scale-to-zero. Put the first N thousand users here.
- Cloudflare R2 for backups — zero egress.
- Upstash free tier for Redis.
- Grafana Cloud free tier for metrics.
- Clerk free tier for auth (< 10k MAU).
- LLM: negotiate startup credits (Anthropic, OpenAI, Together all have programs). Run the classifier locally on a single A10 once traffic justifies — pays back in weeks.
- Our own serverless functions: Fly Machines (pay per second) + Workers (free tier high).

**Napkin unit economics, free tier:** a free user who runs 100 queries/month costs us ~$0.15–$0.40. Acceptable as CAC substitute.

**Napkin unit economics, Hobby ($10):** ~$2–4 cost, ~60–80% margin at target plan-cache hit rate.

**Napkin, Pro:** margin target 75%+ once self-hosted classifier is online.

### 5.6 Things we will *not* do

- Charge for the number of "seats" in Phase 1. Our unit is the DB and the query, not the human.
- Gate features we'd have shipped anyway behind Pro to manufacture urgency.
- Offer "lifetime deals" on AppSumo. That audience is not our audience and the support cost is real.
- Hide prices behind "Contact sales" for anything under Enterprise.

---

## 6. What we should reinvent (deliberately)

Most of the stack is "use the boring thing". But nlqdb has a few places where the existing tool isn't good enough and we should build our own.

1. **The query router.** No existing router decides between PG / Mongo / Redis / DuckDB based on a live workload fingerprint. This is the product.
2. **The NL → plan compiler.** Existing text-to-SQL libraries (LangChain SQL agent, Vanna, etc.) are demos. They don't handle schema drift, don't stream, don't do multi-engine, don't expose trace. We build our own, in-house, tested against a held-out benchmark we curate.
3. **The migration orchestrator with dual-read verification.** Shadow + compare + cutover, per engine pair. No off-the-shelf thing does cross-engine migration safely.
4. **Connection proxy with per-DB quotas.** PgBouncer is the right shape but we need per-user-DB isolation, per-query budget, NL-query cancellation, and live trace surfacing. Fork or write our own thin one in Go.
5. **The NL diff/undo layer.** Before destructive ops, show the diff in plain English + data preview. This is not a library that exists. We build it.
6. **Our own usage metering ingest path.** Lago handles invoicing, but the *ingest* of every query's token+latency stamp must be sub-ms overhead on the hot path. We'll use an async NATS-based path and batch into Lago.
7. **The onboarding itself.** We refuse to build it with a SaaS onboarding framework. It's literally the entire product for 60 seconds; we hand-craft it.

What we should **not** reinvent:
- Postgres. Obviously.
- Auth.
- Payment processor.
- OTEL.
- The MCP protocol (we implement the spec; we don't fork it).
- SQL parsers (use `pg_query`, `sqlparser-rs`).

---

## 7. Risks, honestly

| Risk | Likelihood | Mitigation |
|---|---|---|
| LLM costs kill margins | High | §5.1 mitigations; aggressive plan caching; local classifier. |
| Cross-engine migration corrupts data | Medium | Dual-read verification, staged rollout, chaos tests, reversible cutover. |
| "Simple" is too simple for serious workloads | Medium | Always-available escape hatches: raw connection string, raw SQL, raw Mongo. |
| LLM hallucinates column names → confident wrong answers | High | Static validation against schema after plan gen; confidence gate; structured output. |
| Free tier abuse (crypto miners, scraping) | Medium | Per-IP + per-account rate limits; proof-of-work on signup if needed; anomaly detection. |
| Vendor lock (Neon, Clerk, Anthropic) | Medium | Adapter layer for each; quarterly "can we swap this in a week" drill. |
| We build a text-to-SQL product and someone ships a better one inside Postgres in 18 months | Real | Our moat is the *multi-engine auto-migration*, not NL→SQL. Stay focused on Phase 2. |
| Competitors with deeper pockets (Supabase, Vercel, MongoDB) | High | We out-focus them. They sell platforms; we sell one experience. |

---

## 8. Open questions — to resolve before Phase 2 starts

- Do we expose the natural-language layer to the user's *own* apps as a library (embed NL-querying in their product)? Tempting, but dilutes the message. Park until after Phase 1.
- Multi-region from day 1, or single-region with latency warning? Probably single-region (us-east) + read replicas later.
- When (if ever) do we allow users to write their own migration triggers? ("Always keep in Redis.") Likely yes, as an override, not as a default surface.
- Do we ship a Notebooks-style multi-query document early? Tempting UX win but scope creep for Phase 1.
- Team workspaces: Phase 1 or Phase 2? Probably late Phase 1 — solo-user product first, teams when first 5 customers ask.

---

## 9. Immediate next steps (to kick off Phase 1)

1. Wire DNS for `nlqdb.com` (canonical) and `nlqdb.ai` (apex-redirect → `.com`); see [`DESIGN.md` §2.1](./DESIGN.md). Parking page with the goal-first input as a teaser (live within a week).
2. Stand up the Neon + Fly + Clerk + Stripe scaffolding. Nothing custom yet.
3. Build the chat UI as a standalone page. No routing, no dashboard. One page that can create a DB and send a query.
4. Wire Claude + pgvector schema retrieval behind it.
5. Ship the CLI (Go, single binary) with two commands: `create` and `query`.
6. Ship the MCP server (TypeScript, npm).
7. 20 user tests, iterate onboarding until the 60-second target is hit reliably.
8. Pick the first 5 design partners deliberately (one hobbyist, one startup backend eng, one data analyst, one agent-builder, one solo founder).

---

*This document is living. Update the git history, not the prose, when things change materially.*
