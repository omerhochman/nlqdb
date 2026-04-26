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

// Lazy instruments — created on first use from the global meter.
// Works whether setup landed via setupTelemetry, installTelemetryForTest,
// or (no-op) before any setup. Names + labels pinned in PERFORMANCE §3.2.
//
// Each `lazyCounter` / `lazyHistogram` call auto-registers a reset hook
// so `resetInstrumentsForTest` can't drift from the export list.

type Histogram = ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
type Counter = ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;

const resetFns: Array<() => void> = [];

function lazyCounter(meter: string, name: string, description: string): () => Counter {
  let cached: Counter | undefined;
  resetFns.push(() => {
    cached = undefined;
  });
  return () => {
    if (!cached) {
      cached = metrics.getMeter(meter).createCounter(name, { description });
    }
    return cached;
  };
}

function lazyHistogram(
  meter: string,
  name: string,
  description: string,
  unit: string,
): () => Histogram {
  let cached: Histogram | undefined;
  resetFns.push(() => {
    cached = undefined;
  });
  return () => {
    if (!cached) {
      cached = metrics.getMeter(meter).createHistogram(name, { description, unit });
    }
    return cached;
  };
}

export const dbDurationMs = lazyHistogram(
  "@nlqdb/db",
  "nlqdb.db.duration_ms",
  "Duration of DB queries, in milliseconds.",
  "ms",
);

export const llmCallsTotal = lazyCounter(
  "@nlqdb/llm",
  "nlqdb.llm.calls.total",
  "LLM calls, labelled by provider, operation, status.",
);

export const llmDurationMs = lazyHistogram(
  "@nlqdb/llm",
  "nlqdb.llm.duration_ms",
  "Duration of LLM calls, in milliseconds.",
  "ms",
);

export const llmFailoverTotal = lazyCounter(
  "@nlqdb/llm",
  "nlqdb.llm.failover.total",
  "Provider-chain failovers, labelled by from_provider, to_provider, reason.",
);

export const authEventsTotal = lazyCounter(
  "@nlqdb/api",
  "nlqdb.auth.events.total",
  "Auth events, labelled by type (oauth_callback / verify) and outcome.",
);

export const cachePlanHitsTotal = lazyCounter(
  "@nlqdb/api",
  "nlqdb.cache.plan.hits.total",
  "/v1/ask plan-cache hits (KV lookup returned a cached plan).",
);

export const cachePlanMissesTotal = lazyCounter(
  "@nlqdb/api",
  "nlqdb.cache.plan.misses.total",
  "/v1/ask plan-cache misses (LLM router invoked, KV write follows).",
);

export const webhookStripeIdempotencyErrorsTotal = lazyCounter(
  "@nlqdb/api",
  "nlqdb.webhook.stripe.idempotency_errors.total",
  "Stripe webhook idempotency-insert errors, labelled by stripe_event_type. Genuine D1 failures only — duplicates (ON CONFLICT) are recorded on the span as nlqdb.webhook.duplicate=true, not here.",
);

export const webhookStripeArchiveFailuresTotal = lazyCounter(
  "@nlqdb/api",
  "nlqdb.webhook.stripe.archive_failures.total",
  "Stripe webhook R2 archive failures (post-response, fire-and-forget). Best-effort — the event itself is already recorded in the stripe_events D1 table; this counter just exposes drop visibility.",
);

export function resetInstrumentsForTest(): void {
  for (const fn of resetFns) fn();
}
