# @nlqdb/mcp

Model Context Protocol server. Tools: `nlqdb_query`,
`nlqdb_list_databases`, `nlqdb_describe`. Phase 2.

Published to npm as `@nlqdb/mcp` (DESIGN §3.4, IMPLEMENTATION §5).

**Lockfile invariant:** `@nlqdb/mcp` must have zero database drivers.
CI fails any PR that adds `pg` / `postgres` / `redis` / similar — the
MCP server is a transport, not a data-plane client. All data access
goes through the `/v1/*` HTTP API.

Not yet implemented.
