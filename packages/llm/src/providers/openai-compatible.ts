// Shared chat-completions caller for OpenAI-compatible HTTP APIs
// (Groq, OpenRouter). Lean by design: no SDK deps, just fetch.
//
// Per @nlqdb GUIDELINES §1: we'd rather write 60 lines than pull in
// the OpenAI / Vercel-AI / LangChain SDK trees for what is ultimately
// `POST /v1/chat/completions` with a JSON body.

import { type CallOpts, ProviderError } from "../types.ts";
import { httpReason, readBodySafe, truncate } from "./_shared.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatRequest = {
  url: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  // OpenAI-compat providers honour `response_format: {type:"json_object"}`
  // for structured outputs; we only set it when the caller wants JSON.
  jsonResponse?: boolean;
  // Forwarded into the request body verbatim. Most callers leave this
  // undefined — the provider's defaults are fine.
  temperature?: number;
};

export async function openAICompatibleChat(req: ChatRequest, opts?: CallOpts): Promise<string> {
  const fetchFn = opts?.fetch ?? globalThis.fetch;
  const body = {
    model: req.model,
    messages: req.messages,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.jsonResponse ? { response_format: { type: "json_object" } } : {}),
  };

  let res: Response;
  try {
    res = await fetchFn(req.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError") throw new ProviderError(`POST ${req.url} aborted`, "timeout");
    throw new ProviderError(`POST ${req.url} failed: ${e.message}`, "network");
  }

  if (!res.ok) {
    const bodySnippet = await readBodySafe(res);
    throw new ProviderError(
      `POST ${req.url} → ${res.status}: ${bodySnippet}`,
      httpReason(res.status),
      res.status,
    );
  }

  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    throw new ProviderError(`POST ${req.url} → 200 but body not JSON`, "parse");
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ProviderError(
      `POST ${req.url} → 200 missing choices[0].message.content (got ${truncate(JSON.stringify(parsed), 120)})`,
      "parse",
    );
  }
  return content;
}
