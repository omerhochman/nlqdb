// Stripe SDK singleton for the Workers runtime.
//
// Slice 7 only consumes Stripe webhooks (no outbound API calls), so
// the API key is a placeholder. When the Phase 1 Checkout slice lands,
// swap to `env.STRIPE_SECRET_KEY` from `cloudflare:workers`.
//
// `createFetchHttpClient` + `createSubtleCryptoProvider` route the SDK
// through Web Crypto + native fetch, which is what Workers can run
// (the default Node http module isn't available even with
// `nodejs_compat`). The crypto provider is passed per-call to
// `constructEventAsync`; the http client is set on the constructor.
//
// `apiVersion` is pinned to `2026-04-22.dahlia` — the dashboard
// webhook endpoint is created with the same version so dispatched
// payload shapes match what the SDK types expect. Webhook signature
// verification is API-version-agnostic; the pin matters when we
// start making outbound calls in Phase 1.
//
// Bumping the SDK is the supported way to advance: stripe-node
// types `LatestApiVersion = typeof ApiVersion`, and the runtime
// `Stripe.API_VERSION` constant moves with each release. If we want
// a newer version we bump the SDK and update this literal in lock-step
// — keeping the API version older than the SDK would silently fall
// back to whatever the API decides. See the runbook entry for the
// full bump procedure.

import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

export const stripe = new Stripe("sk_placeholder_webhook_only", {
  apiVersion: STRIPE_API_VERSION,
  httpClient: Stripe.createFetchHttpClient(),
});

export const cryptoProvider = Stripe.createSubtleCryptoProvider();
