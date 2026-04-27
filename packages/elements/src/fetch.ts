// `POST /v1/ask` client. Pure network layer — no DOM, no state.
// `element.ts` wraps it with attribute reads + render swaps.
//
// Auth: cookie-based session (Better Auth `__Host-session`) only
// works same-origin to `app.nlqdb.com` — cross-origin embeds need
// `pk_live_*` keys (Slice 11). Today the API ignores the Bearer
// header but it's sent forward-compat when `api-key` is set.
//
// Aborts propagate as DOMException("AbortError"); callers `try/catch`
// or check the signal. `fetchAsk` never invents an "aborted" sentinel.

export type AskSuccess = {
  status: "ok";
  cached: boolean;
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  summary?: string;
};

// API errors mirror `apps/api/src/ask/types.ts AskError` plus the bare
// string forms the handler emits for `goal_required` / `dbId_required`
// / `invalid_json`. Kept loose (`unknown` payload) so adding a variant
// to AskError doesn't ripple a type bump through the CDN bundle.
export type ApiErrorBody = { status: string; [k: string]: unknown };
export type AskFailure =
  | { kind: "network"; message: string }
  | { kind: "auth"; status: number }
  | { kind: "api"; status: number; error: ApiErrorBody | string };

export type AskOutcome = { ok: true; data: AskSuccess } | { ok: false; failure: AskFailure };

// Structural fetch signature. Narrower than `typeof fetch` so test
// stubs (vi.fn, etc.) don't need to satisfy `fetch.preconnect` and
// other static members we never call.
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type AskParams = {
  endpoint: string;
  goal: string;
  dbId: string;
  apiKey?: string;
  signal?: AbortSignal;
  // Override the default `fetch` — used in tests so they don't have
  // to monkey-patch a global.
  fetchImpl?: FetchLike;
};

export async function fetchAsk(p: AskParams): Promise<AskOutcome> {
  // Authorization to a non-https endpoint would expose `pk_live_*` /
  // session bearers in plaintext on the wire. Warn (don't block —
  // test harnesses + localhost dev are valid). Console spam from
  // refresh polling here is a feature: misuse should be loud.
  if (p.apiKey && !/^https:\/\//i.test(p.endpoint)) {
    console.warn(
      `[nlq-data] sending api-key to non-https endpoint ${p.endpoint} — possible credential leak.`,
    );
  }

  const fetchImpl = p.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (p.apiKey) headers["authorization"] = `Bearer ${p.apiKey}`;

  let response: Response;
  try {
    response = await fetchImpl(p.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ goal: p.goal, dbId: p.dbId }),
      // Same-origin cookie session (Better Auth `__Host-session`)
      // only — host-only cookies are not sent cross-origin even with
      // `include`. Harmless when no cookie is set.
      credentials: "include",
      signal: p.signal,
    });
  } catch (err) {
    // AbortError propagates — callers (element.ts) early-return
    // rather than rendering a fake "network error" placeholder.
    if (err instanceof Error && err.name === "AbortError") throw err;
    return {
      ok: false,
      failure: { kind: "network", message: err instanceof Error ? err.message : String(err) },
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, failure: { kind: "auth", status: response.status } };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Response landed but the body wasn't JSON — likely an HTML
    // error page from a CDN / proxy. Surface as an api failure with
    // the actual HTTP status so devs can correlate, not as "network".
    return {
      ok: false,
      failure: { kind: "api", status: response.status, error: "invalid_json_response" },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      failure: { kind: "api", status: response.status, error: extractError(body) },
    };
  }

  return { ok: true, data: body as AskSuccess };
}

function extractError(body: unknown): ApiErrorBody | string {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === "string") return e;
    if (e && typeof e === "object") return e as ApiErrorBody;
  }
  return "unknown_error";
}
