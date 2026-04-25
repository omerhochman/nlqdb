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

> **Status (Phase 0):** runtime endpoints land in Slices 6–7. The examples document the API the slices are building toward — call sites are the spec.

## Status

Pre-alpha. Planning + Phase 0 build.

- [DESIGN.md](./DESIGN.md) — system design (auth, pricing, $0 stack, AI-model selection, hello-world).
- [PLAN.md](./PLAN.md) — phased roadmap, alternative-tech evaluation, cost discussion.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — Phase 0 plan + prerequisites checklist.
- [PERFORMANCE.md](./PERFORMANCE.md) — SLOs, latency budgets, span/metric catalog.
- [GUIDELINES.md](./GUIDELINES.md) — four-habit decision rules.
- [RUNBOOK.md](./RUNBOOK.md) — what's actually provisioned right now.
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
