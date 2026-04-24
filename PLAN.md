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

**Goal:** ship the experience before the engine. The Phase 1 backend is a
thin shim — one shared Postgres + an LLM. We buy the right to iterate on
UX with real users. Just two actions end-to-end:

```
create_database(name)           -> db handle + API key
query(db, "natural language")   -> rows + NL answer + trace
```

Surface detail (onboarding, chat, API, CLI, MCP) lives in
[`DESIGN.md` §3, §14](./DESIGN.md). This section covers only what's
unique to Phase 1 rationale.

### 1.1 Onboarding — anti-patterns we refuse

Full flow in `DESIGN §0.1, §3.1, §14.1`. Hard rules for Phase 1:
no wizard, no email-verification wall, no "choose your plan" before
first query, no auto-charge without a second explicit confirmation, no
modals interrupting the chat, no "getting started" video.

### 1.2 Chat principles

Full spec in `DESIGN §3.2, §14.2`. Non-negotiables for Phase 1: every
response has answer / data / trace parts (trace always present, collapsed
by default); streaming tokens + streaming rows; ambiguity surfaces as
inline clickable chips, not another turn; destructive ops show a diff
and require second Enter; history is permalinkable; multi-DB in one
window; keyboard-first.

### 1.3 API shape

Full spec in `DESIGN §14.6`. Phase 1 rules: `Idempotency-Key` on every
mutation; errors are structured payloads with `code`, `suggestions`,
`trace_id`; SSE on `/query` when `Accept: text/event-stream`; `/v1`
forever, additive-only; the trace returned in the API response is
identical to what the UI shows (no info asymmetry).

### 1.4 CLI

Full spec in `DESIGN §3.3, §14.3`. Single static Go binary, subcommand-
first, `--json` for scripts (no TTY detection), `nlq use <db>` writes a
visible `~/.config/nlqdb/config.toml` — no hidden "current DB" state.

### 1.5 MCP server

Full spec in `DESIGN §3.4, §14.4`. Tools: `nlqdb_query`,
`nlqdb_list_databases`, `nlqdb_describe`. Same code path as the HTTP
API; zero DB drivers in `@nlqdb/mcp`'s lockfile (CI-enforced).
`nlq mcp install` (no-arg auto-detect) is the default install; explicit
`<host>` and `NLQDB_API_KEY` env var remain as overrides. Per-host,
per-device key scoping — agents never share credentials.

### 1.6 Phase 1 backend (the shim)

- **One shared Postgres** (Neon free tier). Every user DB is a schema.
- **LLM layer:** Claude primary; structured tool-use loop — intent
  classify → pgvector schema retrieval → SQL emit → execute → summarize.
  See §3 for the full loop.
- **Schema inference on write.** First insert creates columns. Types are
  widened only, never narrowed without explicit migration.
- **Auth:** **Better Auth** (rationale in `DESIGN §4.1`). Magic link +
  passkey + GitHub + Google. Device-code flow for CLI and MCP is
  first-class, not a bolt-on.
- **Rate limits:** per-API-key token bucket in Upstash Redis.
- **Observability:** trace IDs propagate UI → API → LLM → DB; OTEL to
  Grafana Cloud free.

### 1.7 Phase 1 exit criteria

- Median first-query latency < 2s, p95 < 5s.
- 60-second onboarding validated with 20 user tests.
- Five paying customers who say "I'd be sad if this went away."
- MCP server installed in ≥ 3 distinct client apps.
- Zero support tickets about "how do I create a table."

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
| **Better Auth** (TS, OSS, MIT) | ✅ chosen — see `DESIGN §4.1` |
| **Clerk** | ❌ per-MAU pricing cliff, user-shape lock-in |
| **WorkOS AuthKit** | ⚠️ keep for enterprise SSO later |
| **Supabase Auth** | ❌ pulls in whole Supabase |
| **Auth0** | ❌ pricing cliff |
| **Roll our own** | ❌ not the wheel we reinvent |

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

## 9. Immediate next steps

See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for the phased, actionable
plan. High level: Phase 0 stands up the Cloudflare stack + Better Auth +
Neon + LLM router; Phase 1 ships the marketing site + chat + anonymous
mode + `<nlq-data>` v0 + "Copy starter HTML"; Phase 2 ships CLI + MCP +
CSV upload + Stripe live. Five design partners recruited deliberately
(one per persona in [`PERSONAS.md`](./PERSONAS.md)) — Free Pro for 12
months in exchange for 2 calls/month.

---

*This document is living. Update the git history, not the prose, when things change materially.*
