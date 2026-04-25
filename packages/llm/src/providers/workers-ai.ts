// Cloudflare Workers AI — strict-$0 non-US classification fallback
// + future embeddings home. DESIGN §8.1 free-tier limit: 10,000
// Neurons/day. We use the REST endpoint (uniform with the other
// providers) rather than the `AI` Worker binding — keeps the package
// runtime-agnostic and easy to test.

import { type CallOpts, type LLMOperation, type Provider, ProviderError } from "../types.ts";
import { createChatProvider } from "./_chat-provider.ts";
import { httpReason, readBodySafe, truncate } from "./_shared.ts";
import type { ChatMessage } from "./openai-compatible.ts";

const DEFAULT_MODELS: Record<LLMOperation, string> = {
  classify: "@cf/meta/llama-3.1-8b-instruct",
  plan: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  summarize: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
};

export type WorkersAIProviderOptions = {
  accountId: string;
  apiToken: string;
  models?: Partial<Record<LLMOperation, string>>;
};

type WorkersAIResponse = {
  result?: { response?: string };
  success?: boolean;
  errors?: Array<{ code: number; message: string }>;
};

async function workersAIChat(
  accountId: string,
  apiToken: string,
  model: string,
  messages: ChatMessage[],
  opts: CallOpts,
): Promise<string> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId,
  )}/ai/run/${model}`;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ messages }),
      signal: opts.signal,
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError") throw new ProviderError(`POST workers-ai aborted`, "timeout");
    throw new ProviderError(`POST workers-ai failed: ${e.message}`, "network");
  }

  if (!res.ok) {
    const bodySnippet = await readBodySafe(res);
    throw new ProviderError(
      `POST ${url} → ${res.status}: ${bodySnippet}`,
      httpReason(res.status),
      res.status,
    );
  }

  let parsed: WorkersAIResponse;
  try {
    parsed = (await res.json()) as WorkersAIResponse;
  } catch {
    throw new ProviderError(`POST ${url} → 200 but body not JSON`, "parse");
  }
  // 2xx with success:false is application-level failure — distinct
  // bucket so dashboards can tell it apart from transport errors.
  if (parsed.success === false) {
    const msg = parsed.errors?.[0]?.message ?? "workers-ai returned success=false";
    throw new ProviderError(
      `POST ${url} → 200 success=false: ${truncate(msg, 200)}`,
      "provider_error",
    );
  }
  const text = parsed.result?.response;
  if (typeof text !== "string") {
    throw new ProviderError(
      `POST ${url} → 200 missing result.response (got ${truncate(JSON.stringify(parsed), 120)})`,
      "parse",
    );
  }
  return text;
}

export function createWorkersAIProvider(opts: WorkersAIProviderOptions): Provider {
  return createChatProvider({
    name: "workers-ai",
    models: { ...DEFAULT_MODELS, ...opts.models },
    callChat: ({ model, messages, opts: callOpts }) =>
      workersAIChat(opts.accountId, opts.apiToken, model, messages, callOpts),
  });
}
