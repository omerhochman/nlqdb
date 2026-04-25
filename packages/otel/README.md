# @nlqdb/otel

Workers-compatible OpenTelemetry setup. Span + metric infrastructure
for every nlqdb service. Phase 0 / Slice 3 — see
[PERFORMANCE §4](../../PERFORMANCE.md#4-slice-by-slice-instrumentation-plan).

## Why a thin in-house wrapper

`@microlabs/otel-cf-workers` is the popular Workers-OTel package but
remains in `1.0.0-rc.x` as of this slice. We compose stable
`@opentelemetry/*` releases (api 1.9, sdk 2.x, semantic-conventions 1.x)
behind the small `setupTelemetry()` surface here. Swap-out is one file.

## Production usage

```ts
import { setupTelemetry } from "@nlqdb/otel";

export default {
  async fetch(req, env, ctx) {
    const telemetry = setupTelemetry({
      serviceName: "nlqdb-api",
      serviceVersion: "0.1.0",
      otlpEndpoint: env.GRAFANA_OTLP_ENDPOINT,
      authorization: env.GRAFANA_OTLP_AUTHORIZATION,
    });
    try {
      return await handle(req, env);
    } finally {
      ctx.waitUntil(telemetry.forceFlush()); // export before isolate dies
    }
  },
};
```

`setupTelemetry()` is idempotent — call it from every request without
worrying about double-init.

## Test usage

```ts
import { createTestTelemetry } from "@nlqdb/otel/test";

const telemetry = createTestTelemetry();
// ... exercise code that emits spans / metrics
const spans = telemetry.spanExporter.getFinishedSpans();
await telemetry.collectMetrics();
const metrics = telemetry.metricExporter.getMetrics();
```

## Instruments

The package owns a small set of canonical instruments shared across
slices (the names are pinned in PERFORMANCE §3.2):

| Helper             | Type      | Metric name              | Used by   |
| :----------------- | :-------- | :----------------------- | :-------- |
| `dbDurationMs()`   | Histogram | `nlqdb.db.duration_ms`   | Slice 3 (`@nlqdb/db`) |

Every later slice adds its own helpers — keep them here, never inline
in callers.
