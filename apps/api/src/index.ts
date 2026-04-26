import { env } from "cloudflare:workers";
import { createPostgresAdapter } from "@nlqdb/db";
import { type EventEmitter, makeNoopEmitter, makeQueueEmitter } from "@nlqdb/events";
import { authEventsTotal, setupTelemetry } from "@nlqdb/otel";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { makeFirstQueryTracker } from "./ask/first-query.ts";
import { orchestrateAsk } from "./ask/orchestrate.ts";
import { makePlanCache } from "./ask/plan-cache.ts";
import { makeRateLimiter } from "./ask/rate-limit.ts";
import { type AskError, DbConfigError, type DbRecord, type OrchestrateEvent } from "./ask/types.ts";
import { auth, REVOCATION_KEY_PREFIX } from "./auth.ts";
import { resolveDb } from "./db-registry.ts";
import { getLLMRouter } from "./llm-router.ts";
import { makeRequireSession, type RequireSessionVariables } from "./middleware.ts";
import { cryptoProvider, stripe as stripeClient } from "./stripe/client.ts";
import { processWebhook } from "./stripe/webhook.ts";

const SERVICE_VERSION = "0.1.0";

// `Cloudflare.Env` is augmented in src/env.d.ts — using it directly
// (rather than a parallel local `Bindings` type) keeps the two from
// drifting when bindings are added.
const app = new Hono<{ Bindings: Cloudflare.Env; Variables: RequireSessionVariables }>();

// Session gate for `/v1/*` routes. Captures `auth.api.getSession`
// (cookieCache fast path → secondaryStorage → D1) + the KV revocation
// lookup at module load; the callbacks fire per request. See
// src/middleware.ts and PERFORMANCE §4 row 6.
const requireSession = makeRequireSession({
  getSession: async (req) => {
    const result = await auth.api.getSession({ headers: req.headers });
    if (!result) return null;
    return {
      user: { id: result.user.id, email: result.user.email },
      session: { token: result.session.token, userId: result.session.userId },
    };
  },
  isRevoked: async (token) => {
    const hit = await env.KV.get(`${REVOCATION_KEY_PREFIX}${token}`);
    return hit !== null;
  },
});

// Per-request telemetry install + flush. setupTelemetry is idempotent
// — first call per isolate wins; later calls return the cached handle.
// Setup MUST happen before `next()` so handlers' `startActiveSpan` calls
// have a registered global provider. forceFlush MUST happen after
// `next()` so spans created during handler execution are in the
// BatchSpanProcessor buffer when the export fires. Skipped entirely
// when either OTLP secret is unset (local dev / tests).
app.use("*", async (c, next) => {
  const { GRAFANA_OTLP_ENDPOINT, GRAFANA_OTLP_AUTHORIZATION } = c.env;
  const telemetry =
    GRAFANA_OTLP_ENDPOINT && GRAFANA_OTLP_AUTHORIZATION
      ? setupTelemetry({
          serviceName: "nlqdb-api",
          serviceVersion: SERVICE_VERSION,
          otlpEndpoint: GRAFANA_OTLP_ENDPOINT,
          authorization: GRAFANA_OTLP_AUTHORIZATION,
        })
      : undefined;
  await next();
  if (telemetry) {
    c.executionCtx.waitUntil(telemetry.forceFlush());
  }
});

app.get("/v1/health", (c) =>
  c.json({
    status: "ok",
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    bindings: {
      kv: typeof c.env.KV !== "undefined",
      db: typeof c.env.DB !== "undefined",
      events_queue: typeof c.env.EVENTS_QUEUE !== "undefined",
      assets: typeof c.env.ASSETS !== "undefined",
    },
  }),
);

// `POST /v1/ask` (Slice 6).
//
// Content negotiation (DESIGN §14.6 / line 624):
//   - Accept: text/event-stream → SSE { plan → rows → summary }
//   - Accept: application/json → JSON without summary (skips an LLM hop)
//   - Default → JSON with summary
//
// JWT plug-in point: when the plan cache or query execution moves
// to a separate service (Fly machine, Hyperdrive), mint a 30s
// internal JWT here (DESIGN §4.4) and verify it on the receiving
// end. In-isolate today, so signing would be cargo-culting (see
// commit 1a body for the rationale).
app.post("/v1/ask", requireSession, async (c) => {
  const tracer = trace.getTracer("@nlqdb/api");
  return tracer.startActiveSpan("nlqdb.ask", async (span) => {
    const session = c.var.session;
    span.setAttribute("nlqdb.user.id", session.user.id);

    let body: { goal?: unknown; dbId?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      span.end();
      return c.json({ error: "invalid_json" }, 400);
    }
    if (typeof body.goal !== "string" || body.goal.trim().length === 0) {
      span.end();
      return c.json({ error: "goal_required" }, 400);
    }
    if (typeof body.dbId !== "string" || body.dbId.length === 0) {
      span.end();
      return c.json({ error: "dbId_required" }, 400);
    }

    const accept = c.req.header("accept") ?? "";
    const wantsSse = accept.includes("text/event-stream");
    const wantsJsonOnly = accept.includes("application/json") && !accept.includes("*/*");

    const deps = {
      resolveDb: (id: string, tenantId: string) => resolveDb(c.env.DB, id, tenantId),
      planCache: makePlanCache(c.env.KV),
      llm: getLLMRouter(),
      exec: buildExec,
      rateLimiter: makeRateLimiter(c.env.DB),
      firstQuery: makeFirstQueryTracker(c.env.KV),
      events: buildEventEmitter(c.env.EVENTS_QUEUE),
    };
    const orchestrateReq = { goal: body.goal, dbId: body.dbId, userId: session.user.id };

    if (wantsSse) {
      return streamSSE(c, async (stream) => {
        const outcome = await orchestrateAsk(deps, orchestrateReq, {
          onEvent: async (event) => {
            await stream.writeSSE({ event: event.type, data: serializeEvent(event) });
          },
        });
        if (!outcome.ok) {
          await stream.writeSSE({ event: "error", data: JSON.stringify(outcome.error) });
        } else {
          await stream.writeSSE({ event: "done", data: JSON.stringify({ status: "ok" }) });
        }
        span.end();
      });
    }

    const outcome = await orchestrateAsk(deps, orchestrateReq, {
      skipSummary: wantsJsonOnly,
    });
    span.end();
    if (!outcome.ok) {
      const status = errorStatus(outcome.error.status);
      return c.json({ error: outcome.error }, status);
    }
    return c.json(outcome.result);
  });
});

// `POST /v1/stripe/webhook` (Slice 7).
//
// No `requireSession` — Stripe authenticates via signature, not cookies.
// Raw body must be read with `c.req.text()` (NOT `c.req.json()`); the
// parser would normalize whitespace and break HMAC verification.
//
// 503 vs 400 vs 200:
//   - 503 if `STRIPE_WEBHOOK_SECRET` isn't configured at all (deployment
//     misconfig — Stripe retries land here too, which lets us see drops)
//   - 400 if signature is missing or invalid (no retry helps — secret
//     rotation, replay-window expiry, body tamper)
//   - 200 once the event is recorded in `stripe_events` (idempotent)
//
// R2 archive runs in `ctx.waitUntil` so 200 ships before the put completes.
app.post("/v1/stripe/webhook", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: "secret_unconfigured" }, 503);
  }
  const rawBody = await c.req.text();
  const signature = c.req.header("stripe-signature") ?? null;

  const result = await processWebhook(
    {
      signer: stripeClient.webhooks,
      cryptoProvider,
      webhookSecret: c.env.STRIPE_WEBHOOK_SECRET,
      db: c.env.DB,
      r2: c.env.ASSETS,
      events: buildEventEmitter(c.env.EVENTS_QUEUE),
    },
    rawBody,
    signature,
  );

  if (result.status === 200 && result.archive) {
    c.executionCtx.waitUntil(result.archive);
  }
  return c.json(result.body, result.status);
});

// Resolves the DB row's `connection_secret_ref` to a connection URL
// from env. Phase 0 ships one shared Postgres (PLAN line 87), so the
// ref is typically "DATABASE_URL". Throws `DbConfigError` if the ref
// doesn't resolve — operator config bug, distinct from a transient
// "Neon is down" failure.
async function buildExec(db: DbRecord, sql: string) {
  const url = (env as unknown as Record<string, string | undefined>)[db.connectionSecretRef];
  if (!url) {
    throw new DbConfigError(
      `connection_secret_ref ${JSON.stringify(db.connectionSecretRef)} did not resolve in env (db_id=${db.id})`,
    );
  }
  const adapter = createPostgresAdapter({ connectionString: url });
  return adapter.execute(sql);
}

function serializeEvent(event: OrchestrateEvent): string {
  return JSON.stringify(event);
}

// Returns the production queue-backed emitter when the binding is
// present (always in deployed Workers + `wrangler dev --remote`). Falls
// back to a no-op for unit/integration tests and any environment where
// the binding is unset, so tests don't need to mock a queue.
function buildEventEmitter(queue: Queue | undefined): EventEmitter {
  return queue ? makeQueueEmitter(queue) : makeNoopEmitter();
}

// Typed over `AskError["status"]` so adding a new error variant fails
// the compile here rather than silently falling through to 400. 422
// for `schema_unavailable` mirrors REST convention for "request was
// well-formed but the server can't act on it" (the goal+dbId parsed,
// but introspection couldn't fetch a schema this time).
function errorStatus(status: AskError["status"]): 400 | 404 | 422 | 429 | 502 {
  switch (status) {
    case "db_not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "schema_unavailable":
      return 422;
    case "db_unreachable":
    case "db_misconfigured":
    case "llm_failed":
      return 502;
    case "sql_rejected":
      return 400;
  }
}

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
