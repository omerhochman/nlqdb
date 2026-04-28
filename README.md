# nlqdb — natural-language databases

A database you talk to. Create one, query it in English. The infrastructure is invisible.

Two user actions. That's the whole product:

1. Create a database (one word: a name).
2. Talk to it in natural language.

Engine choice (Postgres / Mongo / Redis / DuckDB / pgvector / …), schema inference, indexing, backups, auto-migration between engines based on your actual workload — background concerns you never have to see.

## Use it

**One CLI command:**

```bash
nlq login                                               # opens browser, one click, done
nlq "an orders tracker — customer, drink, total"        # creates the DB
nlq "today's orders, newest first"
```

**One HTML file:**

```html
<script src="https://elements.nlqdb.com/v1.js" type="module"></script>

<nlq-data
  goal="today's orders, newest first"
  api-key="pk_live_…"
  template="table"
  refresh="5s"
></nlq-data>
```

That's the whole backend. No SQL, no schema, no API, no framework.

→ Full hello-world tutorial: [`DESIGN.md` §16](./DESIGN.md#16-hello-world-e2e-fullstack-tutorial--the-1-pager).

## Examples

[`examples/`](./examples) — minimal scaffolds in plain HTML, Next.js, Nuxt, SvelteKit, Astro, plus a CLI-only walkthrough. Each is the smallest valid integration around one `<nlq-data>` element or one CLI session.

> **Status (Phase 0):** `/v1/ask` and `/v1/stripe/webhook` are live in `apps/api`. The `<nlq-data>` element + `apps/web` chat surface land in Phase 1, so these examples are still spec-only end-to-end — call sites are the contract.

## Progress & roadmap

Pre-alpha. The bar below is the path from "Phase 0 backend exists" to
"high-quality production-grade product".

```
Phase 0  Foundations         ████████████████████  10/10  ✓
Phase 1  On-ramp              ████████████░░░░░░░░   5/9   (chat + auth UI tabled)
Phase 2  Agent + dev surfaces ████░░░░░░░░░░░░░░░░   1/7   (@nlqdb/sdk shipped)
Phase 3  Multi-engine engine  ░░░░░░░░░░░░░░░░░░░░   0/5
Phase 4  Enterprise polish    ░░░░░░░░░░░░░░░░░░░░   0/6
```

Each step is 2–4 words on purpose — full spec lives in
[`PLAN.md`](./PLAN.md) and [`IMPLEMENTATION.md`](./IMPLEMENTATION.md).

### Phase 0 — Foundations ✓

- ✓ Worker skeleton
- ✓ KV + D1 bindings
- ✓ Neon adapter + OTel
- ✓ LLM router (strict-$0)
- ✓ Better Auth (GitHub + Google)
- ✓ `/v1/ask` end-to-end
- ✓ Events queue + drain
- ✓ Stripe webhook + R2
- ✓ CI/CD on merge
- ✓ PR preview environments

### Phase 1 — On-ramp (in progress)

After PR #49's pivot, `apps/web` is a coming-soon-style page (waitlist
+ 20-slide showcase carousel) rather than a signed-in chat surface.
The chat backend is tested and dormant; the UI is reworked before
public exposure. Tabled items below are explicitly deferred, not "in
progress".

- ✓ Marketing skeleton (Astro on Workers Static Assets)
- ✓ `<nlq-data>` v0 (live, public `/v1/demo/ask` endpoint)
- ✓ Coming-soon waitlist + 20-slide capability carousel
- ✓ `/v1/waitlist` (D1, atomic dedup, privacy-preserving 200-on-dup)
- ✓ `apps/web` deployed via Workers Static Assets
- ⚡ DNS flip `apps/coming-soon` → `apps/web` (in progress)
- ◯ API keys page (`pk_live_…` for `<nlq-data>` embeds)
- ◯ `<nlq-action>` writes (signed write-tokens)
- ◯ Hello-world tutorial
- ⏸ Chat surface (tabled — UX rework before public; `/v1/chat/messages` API dormant)
- ⏸ Magic-link + GitHub + Google sign-in UI (tabled with chat; `/api/auth/*` API ready)
- ⏸ Anonymous-mode adoption flow (`/v1/anon/adopt` API shipped; web flow tied to chat)

### Phase 2 — Agent + developer surfaces

- ◯ CLI `nlq` (Go binary)
- ◯ MCP server (hosted)
- ◯ Framework wrappers (Next, Nuxt, React, Vue)
- ✓ `@nlqdb/sdk` (typed client; `ask` / `listChat` / `postChat` + `NlqdbApiError`)
- ◯ CSV upload
- ◯ Stripe live + Checkout + Portal
- ◯ Usage metering (Lago)

### Phase 3 — Multi-engine engine (the moat)

- ◯ Workload Analyzer
- ◯ Migration Orchestrator
- ◯ Redis as second engine
- ◯ DuckDB analytics path
- ◯ Dual-read verification

### Phase 4 — Enterprise polish

- ◯ SAML / OIDC SSO
- ◯ Audit log export
- ◯ Per-org quotas + budget caps
- ◯ SOC 2 Type 1
- ◯ EU data residency
- ◯ VPC peering

---

### What's blocking on me (human-only steps)

Things the code can't do for itself. Each block lists the cheapest
trigger to unlock it.

**Right now:** none — PR previews ship via GH Actions (deploy-api,
deploy-web, preview-{api,web,elements}); no manual Cloudflare
dashboard wiring required ([RUNBOOK §6](./RUNBOOK.md)). The earlier
"connect Pages git integration for `nlqdb-elements`" item was made
obsolete by the move to GH Actions for every surface.

**Phase 1 — before public soft launch:**

- ◯ Resend domain verification (DKIM/SPF/DMARC for `nlqdb.com`)
- ◯ LogSnag account → drop `LOGSNAG_TOKEN` + `LOGSNAG_PROJECT` in `.envrc`
- ◯ Plausible self-hosted on Fly (web analytics, free)
- ◯ DNS flip `apps/coming-soon` → `apps/web` when web is content-complete

**Phase 2 — before charging anyone:**

- ◯ Stripe go-live: production keys, Stripe Tax enable
- ◯ Lago on Fly (self-hosted, free) for usage metering
- ◯ Listmonk on Fly (self-hosted, free) for marketing email
- ◯ Apply for Anthropic / OpenAI / Modal / Together startup credits *(non-blocking)*
- ◯ npm publish workflow for `@nlqdb/elements`, `@nlqdb/sdk` *(when v1 is real)*

**Phase 3+ — before enterprise pitches:**

- ◯ Make repo public (currently private through pre-alpha)
- ◯ Submit to Anthropic / Mistral / Bedrock partner programs

---

### Cost ladder — pay only when someone pays you

**Strict rule: $0/month while there are no paying customers.** Then
add only what is strictly forced by traffic or contractual need.

**Today: $0/month** *(+ ~$85/yr unavoidable for the two domain renewals)*

- Cloudflare Free plan — both zones
- Workers / KV / D1 / R2 / Queues / Workers AI — free tier limits
- Neon — 0.5 GB free, scale-to-zero
- Upstash Redis — free tier
- LLM inference — Gemini + Groq + OpenRouter + Workers AI free tiers; Ollama for dev
- Sentry / Grafana Cloud / Resend / LogSnag — free tiers
- GitHub — free private org

**Triggered by the first paying client (transaction-fee only, no monthly):**

- Stripe live mode — only the per-transaction fee on real revenue
- Stripe Tax — 0.5% per live transaction

**Triggered by specific events (only when the event actually happens):**

| Trigger | Upgrade | Monthly cost |
|---|---|---|
| Sustained L7 attack the free WAF can't classify | Cloudflare Pro | $25 |
| Neon DB exceeds 0.5 GB or needs no-pause | Neon Launch | $19 |
| > 3k emails/mo (≈ 100 signups/day) | Resend Pro | $20 |
| > 5k errors/mo | Sentry Team | $26 |
| > 2.5k product events/mo | LogSnag paid | $10 |
| > 100k Worker requests/day | Workers Paid | $5 |
| LLM bills exceed startup credits | Anthropic / OpenAI direct | variable |
| Usage metering needed (Phase 2 paid users) | Lago + Listmonk on 1 Fly Machine | ~$5 |

The point: every line above is gated on a real signal. **Don't
upgrade pre-emptively.** PLAN §5 has the full unit-economics model.

---

### Open scaling decisions (block large-company customers)

None of these matter pre-PMF. Each must be decided before its phase
ships, not before. Listed in order of when they bite.

| Decision | Decide by |
|---|---|
| Multi-tenancy at scale: shared Neon cluster vs per-tenant compute | Phase 2 |
| Per-org billing, quotas, budget caps | Phase 2 |
| SAML / OIDC SSO for org accounts | Phase 2 |
| Audit log export format + retention | Phase 2 |
| Pricing model above Pro (custom Enterprise) | Phase 3 |
| EU data residency option | Phase 2 / 3 |
| Compliance posture: SOC 2 Type 1 → ISO 27001 → GDPR DPIA | Phase 3 |
| VPC peering for Enterprise | Phase 3 |
| Custom contracts (annual commit, MSA, DPA) | Phase 3 |
| Cross-region DR + backup RPO/RTO | Phase 3 |
| First sales-engineering / customer-success hire | Phase 3+ |
| Bug-bounty program (paid vs credit-only) | Phase 3+ |

---

### Reference

- [DESIGN.md](./DESIGN.md) — system design (auth, pricing, $0 stack, AI-model selection, hello-world).
- [PLAN.md](./PLAN.md) — phased roadmap, alternative-tech evaluation, cost discussion.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — Phase 0 plan + prerequisites checklist.
- [PERFORMANCE.md](./PERFORMANCE.md) — SLOs, latency budgets, span/metric catalog.
- [GUIDELINES.md](./GUIDELINES.md) — four-habit decision rules.
- [RUNBOOK.md](./RUNBOOK.md) — what's actually provisioned right now (deploy strategy, preview envs).
- [PERSONAS.md](./PERSONAS.md) — who we're building for.
- [COMPETITORS.md](./COMPETITORS.md) — competitive landscape.

## Getting started (dev)

```bash
git clone git@github.com:nlqdb/nlqdb.git && cd nlqdb
scripts/bootstrap-dev.sh   # installs everything, pulls Ollama models, seeds .envrc
scripts/login-cloud.sh     # signs you into cloud providers that have a CLI flow
```

What `bootstrap-dev.sh` stands up in one shot (see IMPLEMENTATION.md §2.8):

- **Runtimes:** Bun (package manager + JS/TS runtime), Node 20+, Go 1.24+, uv (Python).
- **Formatter + linter:** Biome (JS/TS/JSON/CSS), gofumpt + golangci-lint (Go), ruff (Python).
- **Git hooks:** lefthook — `pre-commit` runs Biome/gofumpt/golangci-lint/ruff on staged files; `commit-msg` enforces Conventional Commits; `pre-push` runs whole-repo checks.
- **Cloud CLIs:** wrangler, flyctl, aws, stripe, gh.
- **Local LLM:** Ollama + `llama3.2:3b` and `qwen2.5:7b` for offline dev against the LLM router.
- **Env / secrets:** `.envrc` with self-generated `BETTER_AUTH_SECRET` / `INTERNAL_JWT_SECRET`, loaded by direnv.

Day-to-day:

```bash
bun run fix          # biome format + lint --write (most issues)
bun run check:all    # biome + golangci-lint + ruff (what CI runs)
bun run hooks:run    # run pre-commit hooks against staged files
```

## Surfaces (planned, Phase 1)

- Web chat UI — single page, 60 seconds from landing to first query, no card required.
- HTTP API — two endpoints: create DB, query DB.
- CLI — single static binary: `nlq new`, `nlq login`, `nlq "..."`.
- MCP server — so agents can use it too.
- `<nlq-data>` / `<nlq-action>` HTML elements — the embeddable backend.
- Plus the platform integrations matrix in [IMPLEMENTATION §10](./IMPLEMENTATION.md#10-platform-integrations--the-matrix) — Nuxt, Next, SvelteKit, Astro, mobile, server middleware, IDE extensions, no-code, iPaaS, analytics tooling, chat platforms.

## Community + legal

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup, branch naming, commits, CLA flow.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1. Reports to `conduct@nlqdb.com`.
- [SECURITY.md](./SECURITY.md) — vulnerability disclosure (`security@nlqdb.com`, GitHub PVR, Signal). 90-day fix target, credit-only Hall of Fame.
- [SUPPORT.md](./SUPPORT.md) — where to ask questions and what we don't (yet) offer.
- [CLA.md](./CLA.md) — Contributor License Agreement, signed once via the bot on your first PR.
- [TRADEMARKS.md](./TRADEMARKS.md) — what you can and can't do with the nlqdb name and logo.
- [SUBPROCESSORS.md](./SUBPROCESSORS.md) — third-party services that may process personal data on our behalf.
- [IMPRESSUM.md](./IMPRESSUM.md) — Swiss UWG-mandated operator disclosures.
- [LEGAL.md](./LEGAL.md) — running checklist of every legal-housekeeping item, what's done vs pending, free-only path documented.
- Privacy policy and terms of service: [nlqdb.com/privacy](https://nlqdb.com/privacy) · [nlqdb.com/terms](https://nlqdb.com/terms).

## License

[FSL-1.1-ALv2](./LICENSE) — Functional Source License, Apache 2.0 future
license. Source-available for any non-competing use; auto-converts to
Apache 2.0 two years after each release. (Pattern used by Sentry,
Convex, and others.)

`nlqdb`™ is an unregistered trademark of the project's licensor. See [TRADEMARKS.md](./TRADEMARKS.md) for usage guidelines.
