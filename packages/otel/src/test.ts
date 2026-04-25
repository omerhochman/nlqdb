// Test helpers — keep production bundle free of in-memory exporters.
//
// Tests deliberately use SimpleSpanProcessor (not BatchSpanProcessor as
// production does) — it exports each span synchronously so assertions
// can read finished spans without round-tripping through batch timers.

import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import {
  installTelemetryForTest,
  resetInstrumentsForTest,
  resetTelemetryForTest,
  type TelemetryHandle,
} from "./index.ts";

export type TestTelemetry = {
  handle: TelemetryHandle;
  spanExporter: InMemorySpanExporter;
  metricExporter: InMemoryMetricExporter;
  // Pull the latest collected batch from the metric reader.
  collectMetrics(): Promise<void>;
  reset(): void;
};

export type CreateTestTelemetryOptions = {
  serviceName?: string;
  serviceVersion?: string;
};

export function createTestTelemetry(opts: CreateTestTelemetryOptions = {}): TestTelemetry {
  resetInstrumentsForTest();
  resetTelemetryForTest();

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName ?? "nlqdb-test",
    [ATTR_SERVICE_VERSION]: opts.serviceVersion ?? "0.0.0-test",
  });
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });

  const handle = installTelemetryForTest({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    metricReaders: [metricReader],
    resource,
  });

  return {
    handle,
    spanExporter,
    metricExporter,
    async collectMetrics() {
      await handle.meterProvider.forceFlush();
    },
    reset() {
      spanExporter.reset();
      metricExporter.reset();
    },
  };
}
