// Slice 5 — telemetry wrapper for the Better Auth catch-all.
//
// `../src/auth.ts` is mocked in `test/setup.ts` so `cloudflare:workers`
// never has to resolve under vitest. We import the (mocked) `auth` here
// and drive the stub handler per-test. Asserts the PERFORMANCE §4 row 5
// instrumentation: `nlqdb.auth.oauth.callback` span on
// `/api/auth/callback/*`, `nlqdb.auth.verify` span on every other
// `/api/auth/*` path, and the `nlqdb.auth.events.total{type, outcome}`
// counter on both.

import { createTestTelemetry, type TestTelemetry } from "@nlqdb/otel/test";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auth } from "../src/auth.ts";
import worker from "../src/index.ts";

const handler = auth.handler as Mock;

type Env = {
  KV: KVNamespace;
  DB: D1Database;
  GRAFANA_OTLP_ENDPOINT?: string;
  GRAFANA_OTLP_AUTHORIZATION?: string;
};

const env: Env = { KV: {} as KVNamespace, DB: {} as D1Database };
const ctx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
};

describe("/api/auth/* telemetry wrapper", () => {
  let telemetry: TestTelemetry;

  beforeEach(() => {
    telemetry = createTestTelemetry();
    handler.mockReset();
  });

  afterEach(() => {
    telemetry.reset();
  });

  async function metric(name: string) {
    await telemetry.collectMetrics();
    const all = telemetry.metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics));
    return all.find((m) => m.descriptor.name === name);
  }

  it("emits nlqdb.auth.oauth.callback span + success event for a 2xx GitHub callback", async () => {
    handler.mockResolvedValue(new Response(null, { status: 302 }));

    const res = await worker.fetch(
      new Request("https://example.com/api/auth/callback/github?code=abc&state=xyz"),
      env,
      ctx,
    );
    expect(res.status).toBe(302);

    const spans = telemetry.spanExporter.getFinishedSpans();
    const oauthSpan = spans.find((s) => s.name === "nlqdb.auth.oauth.callback");
    expect(oauthSpan).toBeDefined();
    expect(oauthSpan?.attributes["nlqdb.auth.provider"]).toBe("github");
    expect(oauthSpan?.attributes["http.response.status_code"]).toBe(302);

    const counter = await metric("nlqdb.auth.events.total");
    expect(counter).toBeDefined();
    const point = counter?.dataPoints.find(
      (dp) => dp.attributes["type"] === "oauth_callback" && dp.attributes["outcome"] === "success",
    );
    expect(point).toBeDefined();
  });

  it("emits a failure event for a 4xx Google callback (bad state)", async () => {
    handler.mockResolvedValue(new Response("invalid state", { status: 400 }));

    const res = await worker.fetch(
      new Request("https://example.com/api/auth/callback/google?code=bad&state=mismatch"),
      env,
      ctx,
    );
    expect(res.status).toBe(400);

    const oauthSpan = telemetry.spanExporter
      .getFinishedSpans()
      .find((s) => s.name === "nlqdb.auth.oauth.callback");
    expect(oauthSpan?.attributes["nlqdb.auth.provider"]).toBe("google");

    const counter = await metric("nlqdb.auth.events.total");
    const point = counter?.dataPoints.find(
      (dp) => dp.attributes["type"] === "oauth_callback" && dp.attributes["outcome"] === "failure",
    );
    expect(point).toBeDefined();
  });

  it("emits nlqdb.auth.verify span + verify event on a non-callback /api/auth path", async () => {
    handler.mockResolvedValue(new Response(JSON.stringify({ user: null }), { status: 200 }));

    const res = await worker.fetch(
      new Request("https://example.com/api/auth/get-session"),
      env,
      ctx,
    );
    expect(res.status).toBe(200);

    const spans = telemetry.spanExporter.getFinishedSpans();
    expect(spans.find((s) => s.name === "nlqdb.auth.verify")).toBeDefined();
    expect(spans.find((s) => s.name === "nlqdb.auth.oauth.callback")).toBeUndefined();

    const counter = await metric("nlqdb.auth.events.total");
    const point = counter?.dataPoints.find(
      (dp) => dp.attributes["type"] === "verify" && dp.attributes["outcome"] === "success",
    );
    expect(point).toBeDefined();
  });

  it("emits a failure event when the handler throws (Hono converts to 500)", async () => {
    handler.mockRejectedValue(new Error("upstream blew up"));

    const res = await worker.fetch(
      new Request("https://example.com/api/auth/callback/github"),
      env,
      ctx,
    );
    // Our wrapper increments the failure counter in its catch block,
    // then re-throws. Hono catches the re-throw and returns 500 — the
    // counter has already fired by then.
    expect(res.status).toBe(500);

    const counter = await metric("nlqdb.auth.events.total");
    const point = counter?.dataPoints.find(
      (dp) => dp.attributes["type"] === "oauth_callback" && dp.attributes["outcome"] === "failure",
    );
    expect(point).toBeDefined();
  });
});
