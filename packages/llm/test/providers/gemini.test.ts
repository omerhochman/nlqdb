import { describe, expect, it } from "vitest";
import { createGeminiProvider } from "../../src/providers/gemini.ts";
import type { ProviderError } from "../../src/types.ts";
import { geminiResponse, mockFetch } from "../_fixtures.ts";

const apiKey = "AIza-test";

describe("createGeminiProvider", () => {
  it("classify parses JSON from candidates[0].content.parts[0].text", async () => {
    const provider = createGeminiProvider({ apiKey });
    const fetch = mockFetch([
      {
        match: /generativelanguage\.googleapis\.com/,
        respond: () => geminiResponse(JSON.stringify({ intent: "data_query", confidence: 0.95 })),
      },
    ]);
    const res = await provider.classify({ utterance: "u" }, { fetch });
    expect(res).toEqual({ intent: "data_query", confidence: 0.95 });
  });

  it("plan parses JSON response", async () => {
    const provider = createGeminiProvider({ apiKey });
    const fetch = mockFetch([
      {
        match: /generativelanguage/,
        respond: () => geminiResponse(JSON.stringify({ sql: "SELECT 4" })),
      },
    ]);
    const res = await provider.plan({ goal: "g", schema: "s", dialect: "postgres" }, { fetch });
    expect(res.sql).toBe("SELECT 4");
  });

  it("summarize returns trimmed text", async () => {
    const provider = createGeminiProvider({ apiKey });
    const fetch = mockFetch([
      { match: /generativelanguage/, respond: () => geminiResponse("\n  one liner  \n") },
    ]);
    const res = await provider.summarize({ goal: "g", rows: [] }, { fetch });
    expect(res.summary).toBe("one liner");
  });

  it("model() returns the configured Gemini model", () => {
    const provider = createGeminiProvider({ apiKey });
    expect(provider.model("classify")).toBe("gemini-2.5-flash");
    expect(provider.model("plan")).toBe("gemini-2.5-flash");
  });

  it("4xx becomes ProviderError reason=http_4xx", async () => {
    const provider = createGeminiProvider({ apiKey });
    const fetch = mockFetch([
      { match: /generativelanguage/, respond: () => new Response("nope", { status: 401 }) },
    ]);
    await expect(provider.classify({ utterance: "x" }, { fetch })).rejects.toMatchObject({
      reason: "http_4xx",
      status: 401,
    } satisfies Partial<ProviderError>);
  });

  it("api key is passed via ?key= query param, not Authorization header", async () => {
    const provider = createGeminiProvider({ apiKey });
    let url = "";
    let auth: string | null = null;
    const fetch = mockFetch([
      {
        match: /generativelanguage/,
        respond: (req) => {
          url = req.url;
          auth = req.headers.get("authorization");
          return geminiResponse(JSON.stringify({ intent: "meta", confidence: 1 }));
        },
      },
    ]);
    await provider.classify({ utterance: "x" }, { fetch });
    expect(url).toContain(`key=${apiKey}`);
    expect(auth).toBeNull();
  });
});
