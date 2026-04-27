import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FetchLike, fetchAsk } from "../src/fetch.ts";

// Minimal `Response`-shaped object — `fetchAsk` only ever touches
// `ok`, `status`, and `.json()`, so we don't bother fabricating
// headers / body streams. Cast through `unknown` to escape the full
// `Response` shape check.
function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const successBody = {
  status: "ok" as const,
  cached: false,
  sql: "SELECT 1",
  rows: [{ a: 1 }],
  rowCount: 1,
};

function call(
  fetchImpl: ReturnType<typeof vi.fn>,
  idx = 0,
): {
  url: string;
  init: RequestInit;
} {
  const c = fetchImpl.mock.calls[idx];
  if (!c) throw new Error(`fetch was not called (idx=${idx})`);
  return { url: c[0] as string, init: c[1] as RequestInit };
}

describe("fetchAsk", () => {
  it("posts goal + dbId as JSON, returns parsed success", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));

    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "the most-loved coffee shops",
      dbId: "coffee",
      fetchImpl,
    });

    expect(outcome).toEqual({ ok: true, data: successBody });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = call(fetchImpl);
    expect(url).toBe("https://api.example/v1/ask");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      goal: "the most-loved coffee shops",
      dbId: "coffee",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["accept"]).toBe("application/json");
    expect(headers["authorization"]).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("attaches Authorization Bearer when api-key is provided", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
    await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      apiKey: "pk_live_abc123",
      fetchImpl,
    });
    const headers = call(fetchImpl).init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer pk_live_abc123");
  });

  it("returns a network failure when fetch rejects", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      fetchImpl,
    });
    expect(outcome).toEqual({
      ok: false,
      failure: { kind: "network", message: "Failed to fetch" },
    });
  });

  it("re-throws AbortError so callers can early-return", async () => {
    const ac = new AbortController();
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn<FetchLike>(async () => {
      ac.abort();
      throw abortErr;
    });
    await expect(
      fetchAsk({
        endpoint: "https://api.example/v1/ask",
        goal: "x",
        dbId: "d",
        signal: ac.signal,
        fetchImpl,
      }),
    ).rejects.toBe(abortErr);
  });

  it("returns auth failure for 401", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ error: "unauthorized" }, { status: 401 }),
    );
    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      fetchImpl,
    });
    expect(outcome).toEqual({ ok: false, failure: { kind: "auth", status: 401 } });
  });

  it("returns auth failure for 403", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, { status: 403 }));
    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      fetchImpl,
    });
    expect(outcome).toEqual({ ok: false, failure: { kind: "auth", status: 403 } });
  });

  it("surfaces structured 4xx errors (rate_limited)", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ error: { status: "rate_limited", limit: 10, count: 11 } }, { status: 429 }),
    );
    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      fetchImpl,
    });
    expect(outcome).toEqual({
      ok: false,
      failure: {
        kind: "api",
        status: 429,
        error: { status: "rate_limited", limit: 10, count: 11 },
      },
    });
  });

  it("surfaces structured 5xx errors (db_unreachable)", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse(
        { error: { status: "db_unreachable", message: "connect ECONNREFUSED" } },
        { status: 502 },
      ),
    );
    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      fetchImpl,
    });
    expect(outcome).toEqual({
      ok: false,
      failure: {
        kind: "api",
        status: 502,
        error: { status: "db_unreachable", message: "connect ECONNREFUSED" },
      },
    });
  });

  it("preserves bare-string error bodies (goal_required / invalid_json)", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ error: "goal_required" }, { status: 400 }),
    );
    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      fetchImpl,
    });
    expect(outcome).toEqual({
      ok: false,
      failure: { kind: "api", status: 400, error: "goal_required" },
    });
  });

  it("falls back to unknown_error when the error body shape is unfamiliar", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ totally: "unexpected" }, { status: 500 }),
    );
    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      fetchImpl,
    });
    expect(outcome).toEqual({
      ok: false,
      failure: { kind: "api", status: 500, error: "unknown_error" },
    });
  });

  it("treats a non-JSON body as an api failure with the response status", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError("Unexpected token <");
          },
        }) as unknown as Response,
    );
    const outcome = await fetchAsk({
      endpoint: "https://api.example/v1/ask",
      goal: "x",
      dbId: "d",
      fetchImpl,
    });
    expect(outcome).toEqual({
      ok: false,
      failure: { kind: "api", status: 502, error: "invalid_json_response" },
    });
  });

  describe("non-https + api-key", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("warns when an api-key is sent to a non-https endpoint", async () => {
      const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
      await fetchAsk({
        endpoint: "http://insecure.example/v1/ask",
        goal: "x",
        dbId: "d",
        apiKey: "pk_live_leakme",
        fetchImpl,
      });
      expect(warnSpy).toHaveBeenCalled();
      const message = warnSpy.mock.calls[0]?.[0] ?? "";
      expect(message).toContain("non-https");
      expect(message).toContain("api-key");
    });

    it("does not warn when no api-key is set", async () => {
      const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
      await fetchAsk({
        endpoint: "http://insecure.example/v1/ask",
        goal: "x",
        dbId: "d",
        fetchImpl,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
