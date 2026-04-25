// @nlqdb/otel — Workers-compatible OpenTelemetry setup.
//
// Phase 0 / Slice 3 lands the SDK + OTLP/HTTP exporters as one-time
// infrastructure (PERFORMANCE §4). Later slices just import the
// instrument helpers below — they don't re-do setup.
//
// Two flavours:
//   • setupTelemetry() — production: OTLP/HTTP to Grafana Cloud.
//     Idempotent: first call wins, subsequent calls return the same handle.
//   • createTestTelemetry() (./test) — vitest: in-memory exporters
//     so assertions can read finished spans + collected metrics.

import { metrics, trace } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  type MetricReader,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export type TelemetryOptions = {
  serviceName: string;
  serviceVersion: string;
  // OTLP/HTTP base — Grafana Cloud format, e.g.
  //   "https://otlp-gateway-prod-us-east-2.grafana.net/otlp"
  // The exporters append `/v1/traces` and `/v1/metrics`.
  otlpEndpoint: string;
  // Authorization header value as the OTLP exporters expect it.
  // Grafana Cloud uses Basic auth: `Basic <base64(instanceId:apiKey)>`.
  authorization?: string;
};

export type TelemetryHandle = {
  tracerProvider: BasicTracerProvider;
  meterProvider: MeterProvider;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

let active: TelemetryHandle | undefined;

export function setupTelemetry(opts: TelemetryOptions): TelemetryHandle {
  if (active) return active;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.serviceVersion,
  });
  const headers = opts.authorization ? { authorization: opts.authorization } : undefined;
  const base = opts.otlpEndpoint.replace(/\/$/, "");

  const traceExporter = new OTLPTraceExporter({ url: `${base}/v1/traces`, headers });
  // BatchSpanProcessor batches spans before exporting — `SimpleSpanProcessor`
  // POSTs synchronously per `span.end()`, which OTel docs flag as
  // "for testing/debugging only" and would burn through the Workers
  // Free-tier 50 subrequests/request limit fast. We rely on
  // `forceFlush()` (called from `ctx.waitUntil` in the Worker handler)
  // to drain the buffer at request end.
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  const metricExporter = new OTLPMetricExporter({ url: `${base}/v1/metrics`, headers });
  // Workers don't reliably tick setInterval across requests, so we
  // rely on per-request `forceFlush()` from the Worker handler. The
  // periodic interval is kept long enough to be a no-op in practice.
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  active = {
    tracerProvider,
    meterProvider,
    async forceFlush() {
      await Promise.all([tracerProvider.forceFlush(), meterProvider.forceFlush()]);
    },
    async shutdown() {
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
      // Unregister globals so subsequent `metrics.getMeter(...)` /
      // `trace.getTracer(...)` calls don't return the now-disabled
      // providers. Mirrors what `installTelemetryForTest` does up-front.
      trace.disable();
      metrics.disable();
      active = undefined;
    },
  };
  return active;
}

// Test-only: install a custom set of processors/readers (in-memory
// exporters) without going through OTLP. Resets any prior global state.
//
// `metrics.setGlobalMeterProvider` / `trace.setGlobalTracerProvider`
// silently no-op on re-registration (OTel's anti-double-init guard);
// each call here `disable()`s the prior provider first so multiple
// beforeEach invocations within one test file install fresh exporters.
export function installTelemetryForTest(opts: {
  spanProcessors: SpanProcessor[];
  metricReaders: MetricReader[];
  resource?: Resource;
}): TelemetryHandle {
  trace.disable();
  metrics.disable();

  const tracerProvider = new BasicTracerProvider({
    resource: opts.resource,
    spanProcessors: opts.spanProcessors,
  });
  trace.setGlobalTracerProvider(tracerProvider);
  const meterProvider = new MeterProvider({
    resource: opts.resource,
    readers: opts.metricReaders,
  });
  metrics.setGlobalMeterProvider(meterProvider);
  active = {
    tracerProvider,
    meterProvider,
    async forceFlush() {
      await Promise.all([tracerProvider.forceFlush(), meterProvider.forceFlush()]);
    },
    async shutdown() {
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
      active = undefined;
    },
  };
  return active;
}

export function resetTelemetryForTest(): void {
  active = undefined;
}

// Lazy histogram instrument for the DB adapter. Created on first use
// from the global meter — works whether setup landed via setupTelemetry,
// installTelemetryForTest, or (no-op) before any setup.
let _dbDurationMs: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]> | undefined;
export function dbDurationMs() {
  if (!_dbDurationMs) {
    _dbDurationMs = metrics.getMeter("@nlqdb/db").createHistogram("nlqdb.db.duration_ms", {
      description: "Duration of DB queries, in milliseconds.",
      unit: "ms",
    });
  }
  return _dbDurationMs;
}

export function resetInstrumentsForTest(): void {
  _dbDurationMs = undefined;
}
