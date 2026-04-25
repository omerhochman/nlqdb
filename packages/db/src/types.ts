// Engine-agnostic database adapter contract. Phase 0 ships the
// `postgres` engine via Neon HTTP (DESIGN §2, IMPLEMENTATION §3).
// Phase 3 may add `redis` / `duckdb` — they implement the same shape.
//
// Per the product framing (memory: feedback_engine_agnostic_abstraction),
// nlqdb is "natural-language databases" — never "natural-language
// Postgres". The adapter interface is the seam that keeps that promise.

export type Engine = "postgres";

export type QueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
};

export type DatabaseAdapter = {
  engine: Engine;
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
};
