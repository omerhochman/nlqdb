# nlqdb — Performance & Observability

The "fast" promise made concrete. This doc pins:

1. **SLOs** we promise to users (§1).
2. **Per-stage latency budgets** that sum to fit the SLOs (§2).
3. **Span / metric / label catalog** so dashboards aren't a snowflake of one-off names (§3).
4. **Slice-by-slice instrumentation hookpoints** so each upcoming PR ships with the right OTel calls (§4).
5. **Sampling + cost discipline** for the Grafana Cloud free tier (§5).
6. **Dashboards-as-code** layout (§6).

Not in scope: architectural rationale (see [DESIGN.md](./DESIGN.md)),
phased plan (see [IMPLEMENTATION.md](./IMPLEMENTATION.md)), current
state of provisioned infra (see [RUNBOOK.md](./RUNBOOK.md)).

---

## 1. SLOs

| Surface                          | p50      | p99      | Notes                                     |
| :------------------------------- | :------- | :------- | :---------------------------------------- |
| `GET /v1/health`                 | < 5 ms   | < 50 ms  | Pure JSON serialize, no I/O.              |
| `POST /v1/ask` — **cache hit**   | < 200 ms | < 500 ms | Plan in KV, just execute SQL.             |
| `POST /v1/ask` — **cache miss**  | < 1.5 s  | < 3.5 s  | Full LLM plan + execute + (opt) summarize. |
| `GET /v1/auth/callback/github`   | < 200 ms | < 1.0 s  | OAuth code exchange + DB user upsert.     |
| `POST /v1/auth/device`           | < 50 ms  | < 200 ms | DB write only.                            |
| `POST /v1/auth/device/token`     | < 100 ms | < 500 ms | DB read + write + JWT sign.               |
| `POST /v1/auth/refresh`          | < 50 ms  | < 200 ms | KV/DB read + JWT sign.                    |

**Error rate:** < 0.1 % 5xx, rolling 1 h, per route.
**Availability:** 99.5 % through Phase 1 → 99.9 % post-PMF.

A breach of either p50 or p99 over the rolling window is a **release-blocking
regression**: the offending slice gets reverted before the next slice starts.

---

## 2. Latency budgets

Each stage gets a per-stage p50 and p99. Stages sum to the SLO with
non-zero headroom. Anything that goes over budget at PR time fails CI
(see §4: every slice instruments + asserts its own stage).

### 2.1 `POST /v1/ask` — cache hit

The hot path. Plan exists in KV; we just look it up, execute SQL, return.

| #  | Stage                                         | p50    | p99    |
| :- | :-------------------------------------------- | :----- | :----- |
| 1  | Edge ingress (warm Worker)                    | 5 ms   | 30 ms  |
| 2  | Auth verify (HMAC-SHA256 on internal JWT)     | 2 ms   | 5 ms   |
| 3  | Rate-limit check (KV read)                    | 5 ms   | 15 ms  |
| 4  | Schema-hash + query-hash compute              | 1 ms   | 5 ms   |
| 5  | Plan-cache lookup (KV read, **hit**)          | 5 ms   | 15 ms  |
| 6  | Neon DB execute (HTTP fetch)                  | 100 ms | 350 ms |
| 7  | Response serialize + edge egress              | 5 ms   | 20 ms  |
|    | **Total**                                     | **123 ms** | **440 ms** |
|    | Headroom vs SLO                               | 77 ms  | 60 ms  |

### 2.2 `POST /v1/ask` — cache miss (worst case: with summarize)

The cold path. LLM dominates; everything else has to stay tight.

| #  | Stage                                         | p50    | p99    |
| :- | :-------------------------------------------- | :----- | :----- |
| 1  | Edge ingress (warm)                           | 5 ms   | 30 ms  |
| 2  | Auth verify                                   | 2 ms   | 5 ms   |
| 3  | Rate-limit check (KV)                         | 5 ms   | 15 ms  |
| 4  | Schema/query hash                             | 1 ms   | 5 ms   |
| 5  | Plan-cache lookup (KV, **miss**)              | 5 ms   | 15 ms  |
| 6  | LLM **classify** (intent: data_query / meta)  | 100 ms | 400 ms |
| 7  | LLM **plan** (NL → SQL)                       | 600 ms | 1500 ms |
| 8  | SQL parse + schema-fit validate               | 5 ms   | 20 ms  |
| 9  | Neon DB execute                               | 100 ms | 350 ms |
| 10 | LLM **summarize** (conditional — see below)   | 300 ms | 800 ms |
| 11 | Plan-cache write (KV)                         | 5 ms   | 20 ms  |
| 12 | Response serialize + egress                   | 5 ms   | 20 ms  |
|    | **Total (with summarize)**                    | **1133 ms** | **3180 ms** |
|    | **Total (no summarize)**                      | **833 ms**  | **2380 ms** |
|    | Headroom vs SLO                               | 367 ms / 667 ms | 320 ms / 1120 ms |

**Summarize is conditional** — only runs when the result row count is
above a threshold (default 5) or when the intent classifier flagged
the query as conversational. Most fact-lookup queries return raw rows
and skip stage 10 entirely.

### 2.3 `POST /v1/auth/callback/github`

| Stage                                  | p50    | p99    |
| :------------------------------------- | :----- | :----- |
| Edge + auth-state cookie verify        | 5 ms   | 20 ms  |
| GitHub OAuth code exchange (HTTP)      | 80 ms  | 400 ms |
| GitHub user fetch                      | 60 ms  | 300 ms |
| DB upsert user + create session        | 30 ms  | 150 ms |
| Cookie set + 302                       | 5 ms   | 30 ms  |
| **Total**                              | **180 ms** | **900 ms** |

### 2.4 Provider-side latencies (reference numbers)

| Provider                     | Operation         | p50    | p99    | Notes                            |
| :--------------------------- | :---------------- | :----- | :----- | :------------------------------- |
| Cloudflare Workers AI        | classify (Llama)  | 80 ms  | 300 ms | Same-region edge — fastest.      |
| Cloudflare Workers AI        | plan              | 500 ms | 1200 ms | Heavier model.                  |
| Gemini 2.0 Flash             | classify          | 150 ms | 500 ms |                                  |
| Gemini 2.0 Flash             | plan              | 700 ms | 1800 ms |                                  |
| Groq (Llama 3.1 70B)         | plan              | 400 ms | 1000 ms | Fastest paid.                    |
| OpenRouter (fallback)        | plan              | 1000 ms| 3000 ms | Used only on multi-provider failover. |
| Neon HTTP (us-east-1)        | SELECT (warm)     | 80 ms  | 300 ms | Cold pool can spike to 1 s.      |
| Cloudflare KV (read, hot)    | get               | 5 ms   | 15 ms  |                                  |
| Cloudflare KV (write)        | put               | 5 ms   | 25 ms  |                                  |

These are *measured-then-budgeted* numbers — when a slice lands its
instrumentation, the dashboards (§6) will show actual p50/p99 per
provider, and §2.4 gets updated with real values.

---

## 3. Span / metric / label catalog

Canonical names. Every slice MUST use these — no one-off variants.

### 3.1 Span names

| Span                          | Wraps                                          |
| :---------------------------- | :--------------------------------------------- |
| `http.server.request`         | Outermost — already standard OTel.             |
| `nlqdb.auth.verify`           | Internal JWT HMAC verify.                      |
| `nlqdb.ratelimit.check`       | KV read for rate-limit window.                 |
| `nlqdb.ask`                   | Top-level wrapper for `/v1/ask` request.       |
| `nlqdb.ask.hash`              | Schema-hash + query-hash compute.              |
| `nlqdb.cache.plan.lookup`     | KV read for cached plan (label `hit=true/false`). |
| `nlqdb.cache.plan.write`      | KV write of new plan.                          |
| `llm.classify`                | Intent classification call.                    |
| `llm.plan`                    | NL → SQL generation.                           |
| `llm.summarize`               | Result summarization (conditional).            |
| `nlqdb.sql.validate`          | SQL parse + schema-fit check.                  |
| `db.query`                    | Neon HTTP execute — standard OTel `db.*`.      |
| `nlqdb.auth.oauth.callback`   | `/v1/auth/callback/github` flow.               |
| `nlqdb.webhook.stripe`        | Stripe webhook handler.                        |
| `nlqdb.events.emit`           | Product-event sink dispatch (LogSnag; PostHog optional Phase 2). Wrapped in `ctx.waitUntil` so it runs **after** the response is returned — zero user-facing latency. Server-side only; no client SDK on the marketing site. |

### 3.2 Metric names

Counters (suffix `.total`):

- `nlqdb.requests.total{route, status_class}` — every request.
- `nlqdb.cache.plan.hits.total` / `nlqdb.cache.plan.misses.total`.
- `nlqdb.llm.calls.total{provider, operation, status}`.
- `nlqdb.llm.failover.total{from_provider, to_provider, reason}`.
- `nlqdb.errors.total{class, route}`.
- `nlqdb.auth.events.total{type, outcome}` — sign-in / refresh / logout.

Histograms (latency in ms — explicit `_ms` suffix):

- `nlqdb.ask.duration_ms{cache_hit, summarized}`.
- `nlqdb.llm.duration_ms{provider, operation}`.
- `nlqdb.db.duration_ms{operation}`.
- `nlqdb.kv.duration_ms{operation}`.

Gauges:

- `nlqdb.tenants.active{window}` — sampled hourly.

### 3.3 Label conventions

Always use these label keys; never invent variants like `tenant`, `tenant-id`, `tenantId`.

| Label                  | Cardinality concern  | Notes                                              |
| :--------------------- | :------------------- | :------------------------------------------------- |
| `nlqdb.tenant_id`      | Bounded by tenant ct | Free tier: keep < 5 k tenants per stack.           |
| `nlqdb.user_id`        | **High** — gated     | Only on auth events; never on per-request metrics. |
| `nlqdb.engine`         | Low (1-3)            | `postgres`, `redis` (Phase 3), `duckdb` (Phase 3). |
| `nlqdb.cache_hit`      | 2                    | `true` / `false`.                                  |
| `llm.provider`         | Low (4)              | `cf-ai`, `gemini`, `groq`, `openrouter`.           |
| `llm.model`            | Low (~10)            | Provider-specific; pin via env config.             |
| `db.system`            | 1                    | `postgresql` for now.                              |
| `route`                | Low (~20)            | `/v1/ask`, `/v1/health`, `/v1/auth/*`.             |
| `status_class`         | 5                    | `2xx` / `3xx` / `4xx` / `5xx` (NOT raw status).    |

**Cardinality rule:** total combined series < 8 k (Grafana Cloud free
tier ceiling at 10 k, leave 2 k headroom). The above bounds are
designed to fit. Any new label must be added here AND get a
cardinality assertion in CI.

---

## 4. Slice-by-slice instrumentation plan

Every slice from 3 onward MUST include:

1. The spans + metrics in the table below.
2. A **vitest assertion** that each new span/metric was emitted
   (using OTel's in-memory test exporter). Missing instrumentation
   fails CI.
3. A **budget assertion** in the same test — if measured p50 in the
   test exceeds 1.5× the §2 budget, fail.

| Slice | New spans                                              | New metrics                                                      | CI assertion                            |
| :---- | :----------------------------------------------------- | :--------------------------------------------------------------- | :-------------------------------------- |
| 3 — Neon adapter      | `db.query` (label `db.system=postgresql`, `db.operation`) | `nlqdb.db.duration_ms{operation}`                                | span emitted; p50 < 200 ms in test.     |
| 4 — LLM router        | `llm.classify` / `llm.plan` / `llm.summarize` (label `llm.provider`, `llm.model`) | `nlqdb.llm.calls.total`, `nlqdb.llm.duration_ms`, `nlqdb.llm.failover.total` | failover counter increments on forced provider failure. |
| 5 — Better Auth       | `nlqdb.auth.verify`, `nlqdb.auth.oauth.callback`, `nlqdb.events.emit` (new sign-in only) | `nlqdb.auth.events.total`                                        | sign-in success + failure both emit OTel events; first-time sign-in fires exactly one `user.registered` into the sink (asserted with stub sink — real `LOGSNAG_TOKEN` not required in CI). |
| 6 — `/v1/ask` E2E     | `nlqdb.ask` (parent), `nlqdb.ask.hash`, `nlqdb.cache.plan.lookup` / `write`, `nlqdb.sql.validate`, `nlqdb.ratelimit.check`, `nlqdb.events.emit` (first-query only) | `nlqdb.ask.duration_ms`, `nlqdb.cache.plan.hits.total` / `misses.total` | end-to-end span tree present; cache hit on second identical request; `user.first_query` fires exactly once per user. |
| 7 — Stripe webhook    | `nlqdb.webhook.stripe`, `nlqdb.events.emit`            | `nlqdb.requests.total{route="/v1/stripe/webhook"}`               | signature verify span emitted; `subscription.created` / `subscription.canceled` / `trial.expired` map 1:1 to events fired into the sink (asserted with stub sink). |

The **OTel SDK + OTLP exporter** lands as part of Slice 3 (one-time
infrastructure). All later slices just call into it.

---

## 5. Sampling + cost discipline

Grafana Cloud free tier ceilings (current as of 2026-04):

- **Metrics:** 10 k active series.
- **Logs:** 50 GB / mo.
- **Traces:** 50 GB / mo.

Sampling rules to stay well under:

| Path                                | Trace sample rate |
| :---------------------------------- | :---------------- |
| `/v1/health`                        | 0 % (never)       |
| `/v1/ask` cache hit                 | 1 %               |
| `/v1/ask` cache miss                | 100 %             |
| `/v1/auth/*`                        | 100 %             |
| Any request returning 5xx           | 100 % (override sampler) |
| Any request returning 4xx           | 10 %              |
| Stripe webhook                      | 100 %             |

**Metrics:** all metrics aggregated at 60 s resolution; histograms
use 8 buckets (0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5 s) — enough
for p50/p95/p99, cheap on series count.

**Logs:** errors at INFO+; everything else at DEBUG only when
`NLQDB_LOG_LEVEL=debug` (off in prod). Never log secrets, query
contents, or PII (tenant_id only).

If any of the three ceilings approaches 80 %, the alert fires (see §6)
and we either raise sampling thresholds or split telemetry across two
stacks before paying.

---

## 6. Dashboards-as-code

Live in `ops/grafana/dashboards/` as JSON, deployed via Grafana
Cloud's `/api/dashboards/db` provisioning endpoint from CI on merge
to `main`. Never edited in the Grafana UI — UI changes are detected
on the next CI run and the JSON wins.

Initial dashboards (lands in Slice 6 alongside the first `/v1/ask` E2E):

| Dashboard            | What it shows                                                              |
| :------------------- | :------------------------------------------------------------------------- |
| `nlqdb-overview`     | All §1 SLOs at a glance, error rate, request rate. Single-pane oncall view. |
| `nlqdb-ask-pipeline` | Per-stage p50/p99 from §2 budgets vs actual; cache hit ratio; LLM provider mix. |
| `nlqdb-providers`    | LLM provider latency comparison, failover rate, error rate per provider.   |
| `nlqdb-auth`         | Sign-in success rate, token refresh rate, OAuth callback p99.              |

Alerts (provisioned alongside dashboards):

- Any SLO p99 over budget for 5 min → page.
- Error rate > 0.5 % for 10 min → page.
- LLM provider failover rate > 5 % over 1 h → ticket.
- Grafana Cloud series count > 8 k → ticket (cost ceiling approach).
- KV / D1 / R2 quota usage > 80 % → ticket.

---

## 7. How this doc evolves

- **Budget changes** require a PR; the PR description must state the
  measurement that motivated the change.
- **New routes** add a row to §1 (SLO) AND §2 (budget) AND §4
  (instrumentation hooks) in the same PR.
- **New providers / engines** add to §2.4 (provider numbers) and
  §3.3 (label values). Backfill measurements within a week of landing.
- **New metrics / labels** require a cardinality estimate in the PR
  description; the CI cardinality assertion catches the rest.
