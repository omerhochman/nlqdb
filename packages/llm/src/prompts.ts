// System prompts for each operation. Intentionally placeholder-grade —
// Slice 6 (`/v1/ask` E2E) tunes them with real schemas, few-shot
// examples, and prompt-cache discipline (DESIGN §8 cost-control rule 3).
// Prompts live here so every provider reuses the same shape.

import type { ClassifyRequest, PlanRequest, SummarizeRequest } from "./types.ts";

export const CLASSIFY_SYSTEM = [
  "You classify a user utterance about a database into one of three intents:",
  '- "data_query": read-only data lookup (SELECT, aggregate, filter).',
  '- "meta": schema / metadata question ("what tables do I have", "describe X").',
  '- "destructive": write or destructive op (INSERT, UPDATE, DELETE, DROP).',
  'Respond with strict JSON: {"intent":"<one of the three>","confidence":<0-1 float>}.',
  "No prose, no code fences.",
].join("\n");

export const PLAN_SYSTEM = [
  "You translate a natural-language goal into a single SQL statement for the named dialect.",
  "Use the provided schema; do not invent tables or columns.",
  'Respond with strict JSON: {"sql":"<single SQL statement, no trailing semicolon>"}.',
  "No prose, no code fences, no explanation.",
].join("\n");

export const SUMMARIZE_SYSTEM = [
  "You summarize a small result set in plain English, in 1–3 sentences.",
  "Quote concrete numbers and named entities. No code blocks, no markdown.",
].join("\n");

export function buildClassifyUser(req: ClassifyRequest): string {
  return `Utterance: ${req.utterance}`;
}

export function buildPlanUser(req: PlanRequest): string {
  return [`Dialect: ${req.dialect}`, `Schema:\n${req.schema}`, `Goal: ${req.goal}`].join("\n\n");
}

export function buildSummarizeUser(req: SummarizeRequest): string {
  // Truncate to keep prompts small — DESIGN §8 cost rule. Summarization
  // over thousands of rows is a Slice 6+ concern (paginate first).
  const sample = req.rows.slice(0, 50);
  return [`Goal: ${req.goal}`, `Rows (JSON):\n${JSON.stringify(sample)}`].join("\n\n");
}
