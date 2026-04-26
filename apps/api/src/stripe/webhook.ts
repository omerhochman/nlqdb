// Stripe webhook handler. Pure function — every external dep is
// passed in. Tests construct stubs; the route handler in
// `src/index.ts` constructs prod deps from the request context.
//
// Pipeline:
//   1. Verify signature against STRIPE_WEBHOOK_SECRET. Bad sig → 400.
//   2. INSERT into stripe_events (event_id PK, ON CONFLICT DO NOTHING
//      RETURNING 1). Duplicate retry → 200 with duplicate=true; no
//      side effects re-fire.
//   3. Dispatch on event.type. Recognised events update the customers
//      table and emit billing.* into the events queue. Unknown events
//      are logged in stripe_events but not acted on (future events
//      slot into the dispatch switch without schema changes).
//   4. UPDATE stripe_events.processed_at on success.
//   5. Caller schedules the R2 archive via ctx.waitUntil — we return
//      the put promise on the result rather than awaiting it inline,
//      so the response isn't blocked on R2 latency.
//
// Failure semantics:
//   - INSERT failure (genuine D1 error, NOT duplicate) → 500, Stripe
//     retries. Counter `nlqdb.webhook.stripe.idempotency_errors.total`
//     increments, structured log records event_id+type for replay.
//   - Dispatch failure AFTER successful insert → 200 (event recorded;
//     reprocess via Stripe Dashboard "Resend" if needed). The span
//     captures the exception.
//   - R2 archive failure → silent (best-effort); span attribute
//     `nlqdb.webhook.archived=false` makes drops queryable.
//
// No `trial.*` events emitted — PLAN §5.3 has no Stripe-side trial
// period. The `subscription.updated` handler doesn't synthesize a
// trial→active transition either; updated is pure state sync.

import type { EventEmitter } from "@nlqdb/events";
import {
  webhookStripeArchiveFailuresTotal,
  webhookStripeIdempotencyErrorsTotal,
} from "@nlqdb/otel";
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type Stripe from "stripe";

// Narrowed stand-in for `Stripe.WebhookSignature`. We only call
// `constructEventAsync`; tests stub a single function, production
// passes the real `stripeClient.webhooks` (structurally compatible).
export type WebhookSigner = {
  constructEventAsync(
    payload: string,
    header: string,
    secret: string,
    tolerance?: number,
    cryptoProvider?: InstanceType<typeof Stripe.CryptoProvider>,
  ): Promise<Stripe.Event>;
};

export type StripeWebhookDeps = {
  signer: WebhookSigner;
  // Web Crypto provider — required on Workers since Node `crypto` isn't
  // available. Production = singleton; tests can pass `undefined` and
  // the SDK uses the default (which works under Node-the-test-runtime).
  cryptoProvider?: InstanceType<typeof Stripe.CryptoProvider>;
  webhookSecret: string;
  db: D1Database;
  // R2 binding — optional. When undefined, archive step is skipped
  // (the result's `archive` field is undefined too).
  r2?: R2Bucket;
  events: EventEmitter;
};

export type StripeWebhookResult =
  | {
      status: 200;
      body: { received: true; duplicate: boolean };
      // Caller wraps this in ctx.waitUntil so R2 doesn't block the
      // response. Undefined when no R2 binding or duplicate event.
      archive?: Promise<unknown>;
    }
  | { status: 400; body: { error: "invalid_signature" } }
  | { status: 503; body: { error: "secret_unconfigured" } }
  | { status: 500; body: { error: "internal" } };

export async function processWebhook(
  deps: StripeWebhookDeps,
  rawBody: string,
  signature: string | null,
): Promise<StripeWebhookResult> {
  const tracer = trace.getTracer("@nlqdb/api");

  return tracer.startActiveSpan("nlqdb.webhook.stripe", async (span) => {
    try {
      if (!signature) {
        span.setAttribute("nlqdb.webhook.signature_valid", false);
        return { status: 400 as const, body: { error: "invalid_signature" as const } };
      }

      let event: Stripe.Event;
      try {
        event = await deps.signer.constructEventAsync(
          rawBody,
          signature,
          deps.webhookSecret,
          undefined,
          deps.cryptoProvider,
        );
        span.setAttribute("nlqdb.webhook.signature_valid", true);
      } catch (err) {
        span.setAttribute("nlqdb.webhook.signature_valid", false);
        recordSpanError(span, err);
        return { status: 400 as const, body: { error: "invalid_signature" as const } };
      }

      span.setAttribute("nlqdb.webhook.event_id", event.id);
      span.setAttribute("nlqdb.webhook.event_type", event.type);

      const r2Key = computeR2Key(event);

      // Idempotency insert. ON CONFLICT...RETURNING:
      //   - first time     → row.exists = 1 (process)
      //   - duplicate      → first() returns null (already processed; skip)
      //   - genuine error  → throws (counter + 500 so Stripe retries)
      let isDuplicate: boolean;
      try {
        const inserted = await deps.db
          .prepare(
            "INSERT INTO stripe_events (event_id, type, payload_r2_key) VALUES (?, ?, ?) " +
              "ON CONFLICT(event_id) DO NOTHING RETURNING 1 AS ok",
          )
          .bind(event.id, event.type, r2Key)
          .first<{ ok: number }>();
        isDuplicate = inserted === null;
      } catch (err) {
        webhookStripeIdempotencyErrorsTotal().add(1, { stripe_event_type: event.type });
        recordSpanError(span, err);
        // Structured log for replay: operator finds it via `wrangler tail`,
        // grabs the event_id, replays from Stripe Dashboard.
        console.error(
          JSON.stringify({
            level: "error",
            msg: "stripe_events_insert_failed",
            event_id: event.id,
            event_type: event.type,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return { status: 500 as const, body: { error: "internal" as const } };
      }

      span.setAttribute("nlqdb.webhook.duplicate", isDuplicate);

      if (isDuplicate) {
        return { status: 200 as const, body: { received: true as const, duplicate: true } };
      }

      // Dispatch. Failures here don't 5xx — the event is already
      // recorded in stripe_events, so Stripe retrying would just hit
      // the duplicate path. Operator replays via Dashboard if needed.
      // The `dispatchOk` flag gates the processed_at UPDATE below so
      // a failed dispatch leaves processed_at = NULL — that's the
      // queryable signal a stuck-event sweeper (or operator) can find.
      // `dispatchEvent`'s `default: return` is the no-op for unhandled
      // types — they record in `stripe_events` and that's all we promise.
      let dispatchOk = true;
      try {
        await dispatchEvent(deps, event);
      } catch (err) {
        dispatchOk = false;
        recordSpanError(span, err);
        console.error(
          JSON.stringify({
            level: "error",
            msg: "stripe_dispatch_failed",
            event_id: event.id,
            event_type: event.type,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }

      // Mark processed only when dispatch succeeded (or wasn't needed
      // for an unhandled event type — those are recorded for audit
      // and that's all we promise).
      if (dispatchOk) {
        try {
          await deps.db
            .prepare("UPDATE stripe_events SET processed_at = unixepoch() WHERE event_id = ?")
            .bind(event.id)
            .run();
        } catch (err) {
          recordSpanError(span, err);
        }
      }

      // Archive: caller decides scheduling. The R2 binding's put returns
      // a promise we hand back; the route handler does
      // `c.executionCtx.waitUntil(result.archive)` so 200 ships first.
      // Failure visibility is via the counter + warn log — span
      // attributes can't be set here because the parent span has
      // already ended by the time this promise resolves.
      const archive = deps.r2
        ? deps.r2
            .put(r2Key, rawBody, {
              httpMetadata: { contentType: "application/json" },
            })
            .then(undefined, (err) => {
              webhookStripeArchiveFailuresTotal().add(1);
              console.warn(
                JSON.stringify({
                  level: "warn",
                  msg: "stripe_r2_archive_failed",
                  event_id: event.id,
                  r2_key: r2Key,
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            })
        : undefined;

      return {
        status: 200 as const,
        body: { received: true as const, duplicate: false },
        ...(archive ? { archive } : {}),
      };
    } finally {
      span.end();
    }
  });
}

// stripe-events/2026/04/26/evt_xxx.json — date-partitioned, easy
// glob-by-day for human grep, plays well with future R2 lifecycle
// rules ("delete > 90 days").
function computeR2Key(event: Stripe.Event): string {
  const date = new Date(event.created * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `stripe-events/${yyyy}/${mm}/${dd}/${event.id}.json`;
}

async function dispatchEvent(deps: StripeWebhookDeps, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(deps, event.data.object as Stripe.Checkout.Session);
      return;
    case "customer.subscription.created":
      await handleSubscriptionCreated(deps, event.data.object as Stripe.Subscription);
      return;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(deps, event.data.object as Stripe.Subscription);
      return;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(deps, event.data.object as Stripe.Subscription);
      return;
    default:
      return;
  }
}

// Slice 7's only path that creates a customers row. The Phase 1 Checkout
// endpoint MUST set `client_reference_id: userId` and use mode='subscription'
// — that's the contract this handler depends on. Without client_reference_id
// we can't link the Stripe customer to a user, so we log and skip rather
// than create an orphan row.
async function handleCheckoutCompleted(
  deps: StripeWebhookDeps,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = session.client_reference_id;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

  if (!userId || !stripeCustomerId) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "checkout_completed_missing_ids",
        session_id: session.id,
        has_user_id: Boolean(userId),
        has_customer_id: Boolean(stripeCustomerId),
      }),
    );
    return;
  }

  // Status is unknown at checkout-complete (subscription state arrives
  // via the subsequent customer.subscription.created event). Default to
  // 'incomplete' until that fires.
  await deps.db
    .prepare(
      "INSERT INTO customers (user_id, stripe_customer_id, stripe_subscription_id, status) " +
        "VALUES (?, ?, ?, 'incomplete') " +
        "ON CONFLICT(user_id) DO UPDATE SET " +
        "stripe_customer_id = excluded.stripe_customer_id, " +
        "stripe_subscription_id = excluded.stripe_subscription_id, " +
        "updated_at = unixepoch()",
    )
    .bind(userId, stripeCustomerId, stripeSubscriptionId)
    .run();
}

async function handleSubscriptionCreated(
  deps: StripeWebhookDeps,
  sub: Stripe.Subscription,
): Promise<void> {
  const resolved = await resolveSubUser(deps.db, sub);
  if (!resolved) return;

  const fields = extractSubscriptionFields(sub);
  await syncSubscriptionFields(deps.db, sub, fields, resolved.userId);

  if (!fields.priceId) {
    warnMissingPriceId("subscription_created_missing_price", sub);
    return;
  }
  // Use Stripe's sub.id as the LogSnag idempotency key — `dispatchEvent`
  // doesn't see the wrapping Stripe.Event.id, and sub.id is unique per
  // subscription, so two created events for the same sub would dedupe.
  await deps.events.emit(
    {
      name: "billing.subscription_created",
      userId: resolved.userId,
      customerId: resolved.customerId,
      subscriptionId: sub.id,
      priceId: fields.priceId,
    },
    { id: `billing.subscription_created.${sub.id}` },
  );
}

async function handleSubscriptionUpdated(
  deps: StripeWebhookDeps,
  sub: Stripe.Subscription,
): Promise<void> {
  const resolved = await resolveSubUser(deps.db, sub);
  if (!resolved) return;

  const fields = extractSubscriptionFields(sub);
  await syncSubscriptionFields(deps.db, sub, fields, resolved.userId);
  // No emit — `updated` is pure state sync. Created/canceled have
  // their own events.
}

async function handleSubscriptionDeleted(
  deps: StripeWebhookDeps,
  sub: Stripe.Subscription,
): Promise<void> {
  const resolved = await resolveSubUser(deps.db, sub);
  if (!resolved) return;

  await deps.db
    .prepare("UPDATE customers SET status = 'canceled', updated_at = unixepoch() WHERE user_id = ?")
    .bind(resolved.userId)
    .run();

  const priceId = sub.items.data[0]?.price.id ?? null;
  if (!priceId) {
    warnMissingPriceId("subscription_canceled_missing_price", sub);
    return;
  }
  await deps.events.emit(
    {
      name: "billing.subscription_canceled",
      userId: resolved.userId,
      customerId: resolved.customerId,
      subscriptionId: sub.id,
      priceId,
    },
    { id: `billing.subscription_canceled.${sub.id}` },
  );
}

// Resolves a Stripe.Subscription's customer to an nlqdb user_id. Returns
// null (with a warn log) when the customer isn't a string, or no
// customers row matches — typical for out-of-band subs (Dashboard, CLI
// test). Centralizes the warn so all three subscription handlers behave
// the same way; previously created warned and updated/deleted were silent.
async function resolveSubUser(
  db: D1Database,
  sub: Stripe.Subscription,
): Promise<{ userId: string; customerId: string } | null> {
  const customerId = typeof sub.customer === "string" ? sub.customer : null;
  if (!customerId) return null;
  const row = await db
    .prepare("SELECT user_id FROM customers WHERE stripe_customer_id = ?")
    .bind(customerId)
    .first<{ user_id: string }>();
  if (!row) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "subscription_no_user_mapping",
        subscription_id: sub.id,
        customer_id: customerId,
      }),
    );
    return null;
  }
  return { userId: row.user_id, customerId };
}

async function syncSubscriptionFields(
  db: D1Database,
  sub: Stripe.Subscription,
  fields: SubscriptionFields,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE customers SET " +
        "stripe_subscription_id = ?, status = ?, current_period_end = ?, " +
        "cancel_at_period_end = ?, price_id = ?, updated_at = unixepoch() " +
        "WHERE user_id = ?",
    )
    .bind(
      sub.id,
      sub.status,
      fields.currentPeriodEnd,
      fields.cancelAtPeriodEnd,
      fields.priceId,
      userId,
    )
    .run();
}

function warnMissingPriceId(msg: string, sub: Stripe.Subscription): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      msg,
      subscription_id: sub.id,
    }),
  );
}

type SubscriptionFields = {
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: number;
  priceId: string | null;
};

// Pulls fields we persist to `customers` from a Subscription.
// `current_period_end` lives on `SubscriptionItem` (moved off the
// Subscription object in 2025-09 and still there in
// 2026-04-22.dahlia, the version pinned in src/stripe/client.ts).
function extractSubscriptionFields(sub: Stripe.Subscription): SubscriptionFields {
  const item = sub.items.data[0];
  return {
    currentPeriodEnd: item?.current_period_end ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
    priceId: item?.price.id ?? null,
  };
}

function recordSpanError(span: Span, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}
