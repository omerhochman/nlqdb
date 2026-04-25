# @nlqdb/db

Engine-agnostic database adapter. Phase 0 ships the `postgres` engine
via Neon's HTTP driver (`@neondatabase/serverless`).

```ts
import { createPostgresAdapter } from "@nlqdb/db";

const db = createPostgresAdapter({ connectionString: env.DATABASE_URL });
const { rows } = await db.execute("SELECT id, email FROM users WHERE id = $1", [userId]);
```

Every `execute` emits a `db.query` span (`db.system=postgresql`,
`db.operation=SELECT|INSERT|UPDATE|DELETE|OTHER`) and records duration
into the `nlqdb.db.duration_ms` histogram — see
[PERFORMANCE §3](../../PERFORMANCE.md#3-span--metric--label-catalog).

## Why an interface, not a re-export of Neon

nlqdb is "natural-language **databases**" — engine-agnostic by design.
Phase 3 may add `redis` / `duckdb` adapters; they implement the same
`DatabaseAdapter` shape so callers (LLM router, plan cache, `/v1/ask`)
never branch on engine.

## Tests

```bash
bun --cwd packages/db run test
```

Tests inject a fake driver — no live Neon required for unit tests.
