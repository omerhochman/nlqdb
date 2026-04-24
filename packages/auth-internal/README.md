# @nlqdb/auth-internal

Signs short-lived (30 s) internal JWTs for service-to-service calls
between Workers (plan cache, pool, LLM router). Ships the verifier
middleware used by every downstream consumer; every one of them has a
test proving they reject unsigned calls (DESIGN §4.4, IMPLEMENTATION
§3).

Phase 0. Internal-only — never published to npm, never imported from
browser code.

Not yet implemented.
