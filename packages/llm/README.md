# @nlqdb/llm

LLM router adapter exposing four endpoints:
`classify | plan | summarize | embed`. Implements the strict-$0
provider chain defined in DESIGN §8.1 — Gemini / Groq / Workers AI /
OpenRouter with forced-failover and a plan cache keyed by
`(schema_hash, query_hash)` (IMPLEMENTATION §3).

Phase 0. First caller is `apps/api`.

Not yet implemented.
