# nlqdb

A database you talk to. Create one, query it in English. The infrastructure is invisible.

Two user actions. That's the whole product:

1. Create a database (one word: a name).
2. Talk to it in natural language.

Everything else — engine choice (Postgres / Mongo / Redis / DuckDB / pgvector / ...), schema inference, indexing, backups, auto-migration between engines based on your actual workload — is a background concern you never have to see, unless you want to.

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

## Status

Pre-alpha. Planning phase.

- [DESIGN.md](./DESIGN.md) — high-level system design (surfaces, auth, pricing, $0 stack, AI-model selection, CI/CD, hello-world tutorial).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — phased execution plan and the $0/no-card prerequisites checklist (accounts, API keys).
- [PLAN.md](./PLAN.md) — phased roadmap, architecture, alternative-tech evaluation, cost/pricing discussion.
- [PERSONAS.md](./PERSONAS.md) — who we're building for (and who we're not), prioritized use cases.
- [COMPETITORS.md](./COMPETITORS.md) — competitive landscape.

## Surfaces (planned, Phase 1)

- Web chat UI — single page, 60 seconds from landing to first query, no card required.
- HTTP API — two endpoints: create DB, query DB.
- CLI — single static binary: `nlq db create`, `nlq query`, `nlq chat`.
- MCP server — so agents can use it too.

## License

TBD.
