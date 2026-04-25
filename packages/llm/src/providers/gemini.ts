// Google AI Studio (Gemini) — strict-$0 plan workhorse + hard-plan
// fallback. DESIGN §8.1 free-tier limits: 500 RPD on Flash, 100 RPD
// on Pro. Wire format is Google's, not OpenAI's.

import { type CallOpts, type LLMOperation, type Provider, ProviderError } from "../types.ts";
import { createChatProvider } from "./_chat-provider.ts";
import { httpReason, readBodySafe, truncate } from "./_shared.ts";
import type { ChatMessage } from "./openai-compatible.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_MODELS: Record<LLMOperation, string> = {
  classify: "gemini-2.5-flash",
  plan: "gemini-2.5-flash",
  summarize: "gemini-2.5-flash",
};

export type GeminiProviderOptions = {
  apiKey: string;
  models?: Partial<Record<LLMOperation, string>>;
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

// Gemini's chat shape: a single user `contents` block plus a
// `systemInstruction`. We collapse our `[system, user]` messages array
// back into Gemini's structure here so the rest of the package works
// with the OpenAI-shaped messages format.
async function geminiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  jsonMode: boolean,
  opts: CallOpts,
): Promise<string> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const url = `${BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const userText = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n");

  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError") throw new ProviderError(`POST gemini aborted`, "timeout");
    throw new ProviderError(`POST gemini failed: ${e.message}`, "network");
  }

  if (!res.ok) {
    const bodySnippet = await readBodySafe(res);
    throw new ProviderError(
      `POST ${BASE}/${model}:generateContent → ${res.status}: ${bodySnippet}`,
      httpReason(res.status),
      res.status,
    );
  }

  let parsed: GeminiResponse;
  try {
    parsed = (await res.json()) as GeminiResponse;
  } catch {
    throw new ProviderError(`POST gemini → 200 but body not JSON`, "parse");
  }
  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new ProviderError(
      `POST gemini → 200 missing candidates[0].content.parts[0].text (got ${truncate(JSON.stringify(parsed), 120)})`,
      "parse",
    );
  }
  return text;
}

export function createGeminiProvider(opts: GeminiProviderOptions): Provider {
  return createChatProvider({
    name: "gemini",
    models: { ...DEFAULT_MODELS, ...opts.models },
    callChat: ({ model, messages, jsonMode, opts: callOpts }) =>
      geminiChat(opts.apiKey, model, messages, jsonMode, callOpts),
  });
}
