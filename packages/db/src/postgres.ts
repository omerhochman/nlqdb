import { neon } from "@neondatabase/serverless";
import { dbDurationMs } from "@nlqdb/otel";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { DatabaseAdapter, QueryResult } from "./types.ts";

// The narrowest seam the adapter actually needs. Production code calls
// `neon(url).query(...)`; tests inject a fake matching this shape.
export type PostgresQueryFn = (
  sql: string,
  params: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>;

export type PostgresAdapterOptions = {
  connectionString?: string;
  // Test override — if provided, used directly and `connectionString` is ignored.
  query?: PostgresQueryFn;
};

export function createPostgresAdapter(opts: PostgresAdapterOptions): DatabaseAdapter {
  const query = opts.query ?? buildNeonQuery(opts.connectionString);
  const tracer = trace.getTracer("@nlqdb/db");

  return {
    engine: "postgres",
    async execute(sqlText: string, params: unknown[] = []): Promise<QueryResult> {
      const operation = detectOperation(sqlText);
      return tracer.startActiveSpan(
        "db.query",
        {
          attributes: {
            "db.system": "postgresql",
            "db.operation": operation,
          },
        },
        async (span) => {
          const startedAt = performance.now();
          try {
            const result = await query(sqlText, params);
            const rows = result.rows;
            return { rows, rowCount: result.rowCount ?? rows.length };
          } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
          } finally {
            const elapsed = performance.now() - startedAt;
            dbDurationMs().record(elapsed, { operation });
            span.end();
          }
        },
      );
    },
  };
}

function buildNeonQuery(connectionString: string | undefined): PostgresQueryFn {
  if (!connectionString) {
    throw new Error("createPostgresAdapter: connectionString or query override is required");
  }
  const sql = neon(connectionString, { fullResults: true });
  return async (text, params) => {
    const result = await sql.query(text, params);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rowCount,
    };
  };
}

// Extract the SQL command name per OTel `db.operation.name` semantic
// convention — first keyword for DML / TCL / DCL, "VERB NOUN" pair for
// DDL (e.g. CREATE TABLE, DROP INDEX). Mirrors the approach in the
// official `@opentelemetry/instrumentation-pg`, which we can't reuse
// here because it hooks into the `pg` client, not Neon's HTTP driver.
//
// Cardinality is naturally bounded: SQL keywords are a finite set
// (~30) and DDL noun phrases add ~10 more — well within PERFORMANCE
// §3.3 limits.
const DDL_VERBS = new Set(["CREATE", "DROP", "ALTER", "TRUNCATE"]);

function detectOperation(sql: string): string {
  // Strip leading whitespace + line/block comments before tokenising.
  const stripped = sql.replace(/^(?:\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "");
  const verbMatch = stripped.match(/^[A-Za-z]+/);
  if (!verbMatch) return "UNKNOWN";
  const verb = verbMatch[0].toUpperCase();
  if (!DDL_VERBS.has(verb)) return verb;
  const nounMatch = stripped.slice(verbMatch[0].length).match(/^\s+([A-Za-z]+)/);
  return nounMatch?.[1] ? `${verb} ${nounMatch[1].toUpperCase()}` : verb;
}
