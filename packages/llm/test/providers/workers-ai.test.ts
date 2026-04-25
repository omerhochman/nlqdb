import { describe, expect, it } from "vitest";
import { createWorkersAIProvider } from "../../src/providers/workers-ai.ts";
import type { ProviderError } from "../../src/types.ts";
import { jsonResponse, mockFetch, workersAIResponse } from "../_fixtures.ts";

const accountId = "acc_test";
const apiToken = "cf_token";

describe("createWorkersAIProvider", () => {
  it("classify parses JSON from result.response", async () => {
    const provider = createWorkersAIProvider({ accountId, apiToken });
    const fetch = mockFetch([
      {
        match: /api\.cloudflare\.com.*\/ai\/run/,
        respond: () => workersAIResponse(JSON.stringify({ intent: "data_query", confidence: 0.8 })),
      },
    ]);
    const res = await provider.classify({ utterance: "u" }, { fetch });
    expect(res.intent).toBe("data_query");
  });

  it("plan parses JSON from result.response", async () => {
    const provider = createWorkersAIProvider({ accountId, apiToken });
    const fetch = mockFetch([
      {
        match: /api\.cloudflare\.com/,
        respond: () => workersAIResponse(JSON.stringify({ sql: "SELECT 5" })),
      },
    ]);
    const res = await provider.plan({ goal: "g", schema: "s", dialect: "postgres" }, { fetch });
    expect(res.sql).toBe("SELECT 5");
  });

  it("summarize returns trimmed text", async () => {
    const provider = createWorkersAIProvider({ accountId, apiToken });
    const fetch = mockFetch([
      { match: /api\.cloudflare\.com/, respond: () => workersAIResponse("the answer  ") },
    ]);
    const res = await provider.summarize({ goal: "g", rows: [] }, { fetch });
    expect(res.summary).toBe("the answer");
  });

  it("model() returns the @cf/-prefixed model id", () => {
    const provider = createWorkersAIProvider({ accountId, apiToken });
    expect(provider.model("classify")).toBe("@cf/meta/llama-3.1-8b-instruct");
  });

  it("URL embeds the account id and model path", async () => {
    const provider = createWorkersAIProvider({ accountId, apiToken });
    let captured = "";
    const fetch = mockFetch([
      {
        match: /api\.cloudflare\.com/,
        respond: (req) => {
          captured = req.url;
          return workersAIResponse(JSON.stringify({ intent: "meta", confidence: 1 }));
        },
      },
    ]);
    await provider.classify({ utterance: "x" }, { fetch });
    expect(captured).toContain(`/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`);
  });

  it("success:false in body becomes ProviderError reason=provider_error", async () => {
    const provider = createWorkersAIProvider({ accountId, apiToken });
    const fetch = mockFetch([
      {
        match: /api\.cloudflare\.com/,
        respond: () =>
          jsonResponse({
            success: false,
            errors: [{ code: 7000, message: "no route for that path" }],
          }),
      },
    ]);
    await expect(provider.classify({ utterance: "x" }, { fetch })).rejects.toMatchObject({
      reason: "provider_error",
    } satisfies Partial<ProviderError>);
  });

  it("error message includes URL and the upstream errors[0].message", async () => {
    const provider = createWorkersAIProvider({ accountId, apiToken });
    const fetch = mockFetch([
      {
        match: /api\.cloudflare\.com/,
        respond: () =>
          jsonResponse({
            success: false,
            errors: [{ code: 7000, message: "no route for that path" }],
          }),
      },
    ]);
    await expect(provider.classify({ utterance: "x" }, { fetch })).rejects.toThrow(
      /no route for that path/,
    );
  });
});
