// Public types for @nlqdb/llm. Operation set tracks PERFORMANCE §4
// row 4 (Slice 4): classify / plan / summarize. embed lands later
// alongside the embeddings pipeline.

export type ProviderName = "gemini" | "groq" | "workers-ai" | "openrouter";

export type LLMOperation = "classify" | "plan" | "summarize";

// Reasons surfaced on `nlqdb.llm.failover.total{reason}` — bounded set
// to keep the label cardinality safe (PERFORMANCE §3.3).
//
// `not_configured` covers the case where a chain entry's provider was
// never registered (e.g. `OPENROUTER_API_KEY` unset at boot) — the
// router still falls through to the next entry, so it's a real
// failover from the dashboards' point of view.
//
// `unknown` covers non-ProviderError exceptions surfacing through the
// chain (programmer errors, unexpected throws). Tagged separately so
// dashboards don't lie that we had a network failure when in fact our
// own code threw.
//
// `provider_error` covers application-level failure on a 2xx — e.g.
// Cloudflare Workers AI returns HTTP 200 with `{success:false}`. It's
// not an HTTP-class error, but it's not a transport or parse problem
// either, so it gets its own bucket.
export type FailoverReason =
  | "http_5xx"
  | "http_4xx"
  | "network"
  | "timeout"
  | "parse"
  | "not_configured"
  | "provider_error"
  | "unknown";

export type ClassifyIntent = "data_query" | "meta" | "destructive";

export type ClassifyRequest = { utterance: string };
export type ClassifyResponse = { intent: ClassifyIntent; confidence: number };

export type PlanRequest = {
  goal: string;
  schema: string;
  dialect: "postgres";
};
export type PlanResponse = { sql: string };

export type SummarizeRequest = {
  goal: string;
  rows: Record<string, unknown>[];
};
export type SummarizeResponse = { summary: string };

// Minimal fetch shape — just the call signature, not the runtime-specific
// static methods (Bun's typeof globalThis.fetch demands a `preconnect`
// method). globalThis.fetch satisfies this; tests pass plain functions.
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CallOpts = {
  // Test injection point — defaults to globalThis.fetch.
  fetch?: FetchLike;
  signal?: AbortSignal;
};

export type Provider = {
  name: ProviderName;
  // Resolved model string (e.g. "llama-3.1-8b-instant") used as the
  // `llm.model` span attribute. Operation-specific because providers
  // commonly use different models for different jobs.
  model(op: LLMOperation): string;
  classify(req: ClassifyRequest, opts?: CallOpts): Promise<ClassifyResponse>;
  plan(req: PlanRequest, opts?: CallOpts): Promise<PlanResponse>;
  summarize(req: SummarizeRequest, opts?: CallOpts): Promise<SummarizeResponse>;
};

// Thrown by providers when the upstream call fails. Carries a
// classified `reason` so the router can stamp `nlqdb.llm.failover.total`
// without re-classifying.
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly reason: FailoverReason,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
