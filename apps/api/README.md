# apps/api — Cloudflare Workers API plane

Phase 0. Houses `POST /v1/ask` (DESIGN §4.1), auth endpoints
(`/v1/auth/{device, device/token, refresh, logout}`, DESIGN §4.3), and
key-management endpoints (DESIGN §4.5).

Deployed via `wrangler deploy`. State lives in Cloudflare D1 +
KV + R2; no origin server.

Not yet implemented.
