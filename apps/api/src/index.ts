import { setupTelemetry } from "@nlqdb/otel";
import { Hono } from "hono";

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

export default app;
