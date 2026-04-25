import { authEventsTotal, setupTelemetry } from "@nlqdb/otel";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { auth } from "./auth.ts";

type Bindings = {
  KV: KVNamespace;
  DB: D1Database;
  // Telemetry: both must be set to ship to Grafana Cloud OTLP.
  // Locally these are empty, so setup is skipped — the test suite
  // installs an in-memory exporter instead (see @nlqdb/otel/test).
  GRAFANA_OTLP_ENDPOINT?: string;
  GRAFANA_OTLP_AUTHORIZATION?: string;
};

const SERVICE_VERSION = "0.1.0";

const app = new Hono<{ Bindings: Bindings }>();

// Per-request telemetry install + flush. Idempotent — first request
// wins, subsequent calls return the cached handle. Skipped locally
// when either secret is unset.
app.use("*", async (c, next) => {
  const { GRAFANA_OTLP_ENDPOINT, GRAFANA_OTLP_AUTHORIZATION } = c.env;
  if (GRAFANA_OTLP_ENDPOINT && GRAFANA_OTLP_AUTHORIZATION) {
    const telemetry = setupTelemetry({
      serviceName: "nlqdb-api",
      serviceVersion: SERVICE_VERSION,
      otlpEndpoint: GRAFANA_OTLP_ENDPOINT,
      authorization: GRAFANA_OTLP_AUTHORIZATION,
    });
    c.executionCtx.waitUntil(telemetry.forceFlush());
  }
  await next();
});

app.get("/v1/health", (c) =>
  c.json({
    status: "ok",
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    bindings: {
      kv: typeof c.env.KV !== "undefined",
      db: typeof c.env.DB !== "undefined",
    },
  }),
);

// Better Auth catch-all (DESIGN §4.1, PERFORMANCE §4 row 5).
//
// Span naming: callbacks get `nlqdb.auth.oauth.callback` (one span per
// IdP code-exchange); every other `/api/auth/*` request — session
// reads, sign-in init, sign-out — gets `nlqdb.auth.verify`. The
// `nlqdb.auth.events.total{type, outcome}` counter increments once per
// request, classifying outcome by HTTP status (2xx/3xx = success,
// otherwise failure).
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const url = new URL(c.req.url);
  const isCallback = url.pathname.startsWith("/api/auth/callback/");
  const provider = isCallback ? url.pathname.split("/")[4] : undefined;
  const spanName = isCallback ? "nlqdb.auth.oauth.callback" : "nlqdb.auth.verify";
  const eventType = isCallback ? "oauth_callback" : "verify";
  // Tracer fetched per request — same pattern as @nlqdb/db / @nlqdb/llm.
  // Picks up whichever provider is registered now (test or production).
  const tracer = trace.getTracer("@nlqdb/api");

  return tracer.startActiveSpan(spanName, async (span) => {
    if (provider) span.setAttribute("nlqdb.auth.provider", provider);
    try {
      const response = await auth.handler(c.req.raw);
      const outcome = response.status < 400 ? "success" : "failure";
      span.setAttribute("http.response.status_code", response.status);
      authEventsTotal().add(1, { type: eventType, outcome });
      return response;
    } catch (err) {
      authEventsTotal().add(1, { type: eventType, outcome: "failure" });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
});

export default app;
