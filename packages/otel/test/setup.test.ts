import { metrics, trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbDurationMs, setupTelemetry } from "../src/index.ts";
import { createTestTelemetry, type TestTelemetry } from "../src/test.ts";

describe("createTestTelemetry", () => {
  let telemetry: TestTelemetry;

  beforeEach(() => {
    telemetry = createTestTelemetry();
  });

  afterEach(() => {
    telemetry.reset();
  });

  it("installs a global tracer that records to the in-memory exporter", async () => {
    const tracer = trace.getTracer("test");
    tracer.startActiveSpan("test.span", (span) => {
      span.setAttribute("k", "v");
      span.end();
    });
    const spans = telemetry.spanExporter.getFinishedSpans();
    expect(spans.map((s) => s.name)).toEqual(["test.span"]);
    expect(spans[0]?.attributes["k"]).toBe("v");
  });

  it("attaches the configured resource so spans carry service.name", async () => {
    const tracer = trace.getTracer("test");
    tracer.startActiveSpan("svc.span", (span) => span.end());
    const span = telemetry.spanExporter.getFinishedSpans()[0];
    expect(span?.resource.attributes["service.name"]).toBe("nlqdb-test");
  });

  it("honours custom serviceName / serviceVersion", async () => {
    telemetry = createTestTelemetry({ serviceName: "custom", serviceVersion: "9.9.9" });
    trace.getTracer("test").startActiveSpan("custom.span", (span) => span.end());
    const span = telemetry.spanExporter.getFinishedSpans()[0];
    expect(span?.resource.attributes["service.name"]).toBe("custom");
    expect(span?.resource.attributes["service.version"]).toBe("9.9.9");
  });

  it("installs a global meter that surfaces collected histograms", async () => {
    const histogram = metrics.getMeter("test").createHistogram("test.duration_ms", { unit: "ms" });
    histogram.record(42, { route: "/v1/test" });
    await telemetry.collectMetrics();
    const all = telemetry.metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics));
    const found = all.find((m) => m.descriptor.name === "test.duration_ms");
    expect(found).toBeDefined();
    expect(found?.dataPoints[0]?.attributes["route"]).toBe("/v1/test");
  });

  it("dbDurationMs() returns the canonical histogram bound to the global meter", async () => {
    dbDurationMs().record(7, { operation: "SELECT" });
    await telemetry.collectMetrics();
    const all = telemetry.metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics));
    const found = all.find((m) => m.descriptor.name === "nlqdb.db.duration_ms");
    expect(found).toBeDefined();
    expect(found?.descriptor.unit).toBe("ms");
  });
});

describe("setupTelemetry", () => {
  // These tests deliberately don't use createTestTelemetry — they
  // exercise the production path with a placeholder OTLP endpoint and
  // never call forceFlush(), so no real network traffic occurs.

  it("returns the cached handle on subsequent calls (idempotent)", () => {
    const a = setupTelemetry({
      serviceName: "x",
      serviceVersion: "0",
      otlpEndpoint: "http://otlp.invalid",
    });
    const b = setupTelemetry({
      serviceName: "y",
      serviceVersion: "1",
      otlpEndpoint: "http://otlp.invalid",
    });
    expect(b).toBe(a);
    return a.shutdown();
  });

  it("shutdown() unregisters the globals so a fresh setup wins", async () => {
    const a = setupTelemetry({
      serviceName: "x",
      serviceVersion: "0",
      otlpEndpoint: "http://otlp.invalid",
    });
    await a.shutdown();
    const b = setupTelemetry({
      serviceName: "y",
      serviceVersion: "1",
      otlpEndpoint: "http://otlp.invalid",
    });
    expect(b).not.toBe(a);
    await b.shutdown();
  });
});
