# nlqdb

A database you talk to. Create one, query it in English. The infrastructure is invisible.

Two user actions. That's the whole product:

1. Create a database (one word: a name).
2. Talk to it in natural language.

Everything else — engine choice (Postgres / Mongo / Redis / DuckDB / pgvector / ...), schema inference, indexing, backups, auto-migration between engines based on your actual workload — is a background concern you never have to see, unless you want to.

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
