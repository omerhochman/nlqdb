// Generic provider builder. Every chat-style provider plugs in a
// per-wire-format `callChat` and gets the three operations (classify
// / plan / summarize) plumbed identically — same prompts, same JSON
// parsing, same `Provider` shape.
//
// Each provider file shrinks to ~25 lines of "name + models + how to
// call my API." Adding a 5th provider becomes a config change, not a
// copy-paste of three nearly-identical methods.

import {
  buildClassifyUser,
  buildPlanUser,
  buildSummarizeUser,
  CLASSIFY_SYSTEM,
  PLAN_SYSTEM,
  SUMMARIZE_SYSTEM,
} from "../prompts.ts";
import type {
  CallOpts,
  ClassifyResponse,
  LLMOperation,
  PlanResponse,
  Provider,
  ProviderName,
} from "../types.ts";
import { parseJsonResponse } from "./_shared.ts";
import type { ChatMessage } from "./openai-compatible.ts";

export type ChatCallArgs = {
  model: string;
  messages: ChatMessage[];
  // Whether the caller expects strict JSON back. Providers that have
  // a native "JSON mode" (OpenAI-compat `response_format`, Gemini
  // `responseMimeType`) should set it; others should still honour the
  // contract via prompting.
  jsonMode: boolean;
  opts: CallOpts;
};

export type ChatProviderImpl = {
  name: ProviderName;
  models: Record<LLMOperation, string>;
  callChat: (args: ChatCallArgs) => Promise<string>;
};

export function createChatProvider(impl: ChatProviderImpl): Provider {
  return {
    name: impl.name,
    model: (op) => impl.models[op],
    async classify(req, opts = {}) {
      const raw = await impl.callChat({
        model: impl.models.classify,
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM },
          { role: "user", content: buildClassifyUser(req) },
        ],
        jsonMode: true,
        opts,
      });
      return parseJsonResponse<ClassifyResponse>(raw);
    },
    async plan(req, opts = {}) {
      const raw = await impl.callChat({
        model: impl.models.plan,
        messages: [
          { role: "system", content: PLAN_SYSTEM },
          { role: "user", content: buildPlanUser(req) },
        ],
        jsonMode: true,
        opts,
      });
      return parseJsonResponse<PlanResponse>(raw);
    },
    async summarize(req, opts = {}) {
      const raw = await impl.callChat({
        model: impl.models.summarize,
        messages: [
          { role: "system", content: SUMMARIZE_SYSTEM },
          { role: "user", content: buildSummarizeUser(req) },
        ],
        jsonMode: false,
        opts,
      });
      return { summary: raw.trim() };
    },
  };
}
