# nlqdb — Development Guidelines

Four habits that keep Phase 0 lean. Apply before writing non-trivial
code; refer back during review.

---

## 1. Reach for a small mature package before building

If the work is minimal logic, or well-trodden ground (routing, JWT
signing, retry/backoff, OTel transport, CSV parsing), first look for
a small, widely-used, actively-maintained package. Only DIY if
nothing fits — or if every candidate brings in too much.

**Lean is non-negotiable.** We'd rather write 30 lines than add a
200 KB framework for one helper. The Workers Free-tier bundle
ceiling is real (3 MiB compressed); the cognitive ceiling on
"transitive deps a future maintainer must understand" is tighter.

Hard-pass criteria:

- RC / pre-1.0 on the critical path (we declined `@microlabs/otel-cf-workers@1.0.0-rc.x`).
- Last release > 12 months ago, or open-PR backlog deeper than the
  release cadence.
- Pulls a heavy peer-dep tree we didn't already have.

Examples that landed this way:

- ✅ [Hono](https://hono.dev) for Workers routing — small, ubiquitous, type-safe.
- ✅ `@neondatabase/serverless` for the Postgres HTTP driver.
- ✅ `@opentelemetry/*` (stable releases, composed behind a thin in-house wrapper) instead of an RC Workers helper.

## 2. Research before DIY

If you decide to build it yourself, spend 10 minutes finding how the
canonical implementations do it *before* writing any code. The
answer is almost always free online.

Sources, in order:

1. The official spec (OTel Semantic Conventions, IETF RFCs, the
   product's own protocol docs).
2. The reference implementation in a popular library
   (e.g. `@opentelemetry/instrumentation-pg` for SQL operation
   extraction).
3. The most-starred TypeScript / Workers / Bun example matching the
   shape of the problem.

A 10-minute Google search is cheaper than shipping a subtly wrong
implementation and catching it in production.

Concrete example in this repo: `detectOperation` in `@nlqdb/db`
mirrors `@opentelemetry/instrumentation-pg`'s first-keyword
extraction. Copying their proven pattern saved us from missing CTE
/ DDL / TCL cases that the original CRUD allowlist silently bucketed
to `OTHER`.

## 3. Eagle-eye overview at all times

Every change must fit the broader system. Before opening the editor,
mentally re-read:

- The current slice's scope in [`apps/api/README.md`](./apps/api/README.md). Don't pre-empt future slices.
- The span / metric / label catalog in [`PERFORMANCE.md §3`](./PERFORMANCE.md#3-span--metric--label-catalog). No one-off names.
- The package's role in [`DESIGN.md §2`](./DESIGN.md#2-system-architecture-high-level). A change that's locally clean but breaks the system shape is worse than the bug it was fixing.
- Whether [`RUNBOOK.md`](./RUNBOOK.md) or any package README drifts when this lands. If yes, update both in the same PR.

Symptoms of having lost the overview:

- Adding a label not in PERFORMANCE §3.3.
- Naming a Worker binding `NLQDB_*` (we use bare names — single-Worker convention).
- Implementing tenant-aware caching when the current slice has no tenants yet.
- Adding a route directly in `apps/api/src/index.ts` without a corresponding entry in the slice plan.

## 4. Developer experience is part of the spec

Every exported function, hook, and config struct ships with DX as an
explicit goal:

- **Minimal required params.** Optional with sensible defaults. If
  the caller passes five options to call you, your internals leaked.
- **One way to do the common thing.** Multiple call shapes for one
  concept is a footgun.
- **Types that autocomplete.** Template literal types, narrow unions,
  branded IDs — not bare `string`.
- **Errors that say what to do next.** `"NEON_API_KEY not set —
  run scripts/bootstrap-dev.sh"` beats `"Error: missing"`.
- **Idempotency + lifecycle clarity.** Setup functions document
  whether they cache / can be called twice safely.
- **Test seams that don't leak production internals.** A test
  override should be the smallest functional shape, not the whole
  underlying client. (See `createPostgresAdapter({ query })` — tests
  inject one function instead of mocking a Neon driver.)

A function whose JSDoc explains *how to call it* has already failed
DX. Make the call site obvious enough that no doc is needed.

Examples that pass:

- `setupTelemetry({ … })` — single call, idempotent, opt-in via env;
  works in tests by default (no-op when `GRAFANA_*` are unset).
- `createPostgresAdapter({ query })` — `query` injection point for
  tests, no need to fake the Neon client.
- `scripts/migrate-d1.sh local|remote` — one positional arg, no
  flags to memorise.

---

This file pairs with [`CONTRIBUTING.md`](./CONTRIBUTING.md) (mechanics:
hooks, branches, commit format) and [`DESIGN.md`](./DESIGN.md)
(architecture). Those are the *what*; this is the *how-we-decide*.
