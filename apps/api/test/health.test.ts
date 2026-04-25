import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

// Slice 2: bindings are typed but tests still pass mock objects. Slice
// 3+ will swap to @cloudflare/vitest-pool-workers / Miniflare for real
// binding behaviour once a handler exercises KV / D1 directly.
type Env = {
  KV: KVNamespace;
  DB: D1Database;
  GRAFANA_OTLP_ENDPOINT?: string;
  GRAFANA_OTLP_AUTHORIZATION?: string;
};

const env: Env = {
  KV: {} as KVNamespace,
  DB: {} as D1Database,
};

const ctx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
};

describe("/v1/health", () => {
  it("returns 200 with status:ok, version, ISO timestamp, and binding presence", async () => {
    const res = await worker.fetch(new Request("https://example.com/v1/health"), env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      version: string;
      timestamp: string;
      bindings: { kv: boolean; db: boolean };
    };
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.bindings).toEqual({ kv: true, db: true });
  });

  it("reports bindings: false when env is empty", async () => {
    const res = await worker.fetch(new Request("https://example.com/v1/health"), {} as Env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bindings: { kv: boolean; db: boolean } };
    expect(body.bindings).toEqual({ kv: false, db: false });
  });

  it("returns 404 for unknown paths", async () => {
    const res = await worker.fetch(new Request("https://example.com/nope"), env, ctx);
    expect(res.status).toBe(404);
  });
});
