# nlqdb sub-processors

**Last updated:** 2026-04-25.

This page lists the third-party service providers ("sub-processors")
that may process personal data on our behalf in delivering nlqdb. We
maintain it under GDPR Article 28(2)/(4) and the EU Standard
Contractual Clauses (Module 2, Clause 9(a)) — sub-processor changes
are notified at least **30 days in advance** by email and on this
page; subscribe at `subprocessors@nlqdb.com` (mention "subscribe" in
the body) to receive updates.

> **Status (Phase 0):** the runtime services that would actually
> process data are not yet generally available. The list below is
> the *planned* sub-processor architecture. Categories marked
> "(planned)" are not yet receiving any user data because the
> corresponding runtime is not deployed. The list will be updated
> at each Phase milestone with effective dates.

## Active sub-processors

| Sub-processor | Purpose | Region of processing | DPA |
| :--- | :--- | :--- | :--- |
| Cloudflare, Inc. | Edge runtime (Workers), DNS, CDN, marketing site (Pages), API gateway, KV / D1 storage, R2 object storage, email routing | Global edge; data-at-rest in US (KV/D1/R2) | https://www.cloudflare.com/cloudflare-customer-dpa/ |

## Planned sub-processors (not yet active)

| Sub-processor | Purpose | Region of processing | DPA |
| :--- | :--- | :--- | :--- |
| Neon, Inc. | Serverless Postgres data plane (`apps/api` Slice 6+) | US-East (us-east-1) | https://neon.tech/dpa |
| Upstash, Inc. | Redis (rate-limit windows, plan cache adjacency) | US-East | https://upstash.com/static/trust/UpstashDPA.pdf |
| Fly.io, Inc. | Self-hosted Plausible analytics + Listmonk newsletter | EU (Frankfurt or Amsterdam region preferred) | https://fly.io/legal/dpa/ |
| Stripe Payments Europe, Ltd. (IE) | Payment processing, billing, tax | EU (Ireland) + US for global processing | https://stripe.com/legal/dpa |
| Resend, Inc. | Transactional email (magic links, security alerts, billing alerts) | US | https://resend.com/legal/dpa |
| Sentry GmbH | Error monitoring (`apps/api`, `apps/web`) | EU (Frankfurt) — Sentry's Frankfurt region selected explicitly | https://sentry.io/legal/dpa/ |
| Grafana Labs Sweden AB | OTLP logs / metrics / traces (Grafana Cloud) | EU (Sweden) | https://grafana.com/legal/dpa/ |
| GitHub, Inc. | Source code, issue tracker, CI, CLA signature store, security advisory hosting | US | https://github.com/customer-terms/github-data-protection-agreement |

## LLM sub-processors

When you submit a query through nlqdb, the prompt — which **may
contain personal data** — is sent to one or more LLM providers
according to the [strict-$0 provider chain in DESIGN §8.1](./DESIGN.md#81-strict-0-inference-path).
We disclose this category separately because it is the most
data-sensitive routing in the product.

| LLM sub-processor | Operations | Region | DPA / training posture |
| :--- | :--- | :--- | :--- |
| Groq, Inc. | classify, summarize | US | DPA on request from `support@groq.com`. Inputs are **not** used for training by default per Groq's Privacy Notice. |
| Google LLC (AI Studio / Gemini API) | plan (Gemini 2.5 Flash) | US, EU, multi-region | Google Cloud DPA covers paid tier; **paid-tier inputs are not used to improve products**. **Free-tier inputs ARE used for training** — production routing uses paid keys; free tier is dev-only. |
| Cloudflare, Inc. (Workers AI) | classify (non-US fallback), embed | Global edge | Covered by the master Cloudflare DPA (linked above); not used for training. |
| OpenRouter, Inc. | universal :free fallback | US | Per-model policy varies; `X-OR-Allow-Training: false` is set on every request and which downstream models we permit is constrained to providers that honour it. |

A user query is **never** routed through more than one provider
sequentially in a single request — failover means the next provider
in the chain receives the prompt only if the previous one failed
(see [`packages/llm`](./packages/llm/README.md)).

## International transfers

Personal data may be transferred outside Switzerland and the EEA, in
particular to the United States. Such transfers are made under:

- the EU **Standard Contractual Clauses** (Commission Decision
  2021/914) plus the FDPIC's Swiss addendum;
- the **EU–US Data Privacy Framework** and the
  **Swiss–US Data Privacy Framework** for sub-processors that have
  self-certified (the FDPIC recognised the Swiss DPF on 15 September
  2024);
- the **UK International Data Transfer Addendum (IDTA)** for transfers
  reaching the United Kingdom.

## How to receive notifications of changes

We will notify you at least **30 calendar days** before adding or
replacing a sub-processor. To subscribe, email
`subprocessors@nlqdb.com` with the word "subscribe" in the body. To
object, reply to a notification email within the 30-day window;
unresolved objections give the customer a right to terminate the
service.

## Customer DPA

We sign DPAs with controllers (our customers) on request. See
[DPA.md](./DPA.md) for the template, or email `legal@nlqdb.com`.

## Contact

`legal@nlqdb.com` for questions; `dpo@nlqdb.com` for data-protection
matters specifically.
