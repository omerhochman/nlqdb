// Better Auth singleton. Wired at module load via `cloudflare:workers`'s
// top-level `env` (DESIGN §4.1, IMPLEMENTATION §3, RUNBOOK §5/§5b).
//
// Constructing `betterAuth({...})` is pure config — no I/O — so it's
// safe at top level despite the Workers "no I/O outside request context"
// rule. The D1 dialect just stores the `env.DB` reference; queries fire
// only inside `auth.handler(req)` during a request.
//
// Provider creds switch on `env.NODE_ENV`:
// - production: `OAUTH_GITHUB_*`
// - development (wrangler dev): `OAUTH_GITHUB_*_DEV`
// Google has a single OAuth client (one consent screen) — no _DEV split.
//
// Tests mock this module entirely (`vi.mock("../src/auth.ts", …)` in
// apps/api/test/setup.ts) so the real instance never loads under
// vitest — `cloudflare:workers` doesn't resolve there.
//
// `session.cookieCache` is intentionally NOT enabled here: the only
// session-aware endpoint right now is `/api/auth/get-session`, with
// no /v1/* consumers yet. Cookie cache pairs with the KV revocation
// set (DESIGN §4.3, §4.5) — both land together in Slice 6 alongside
// `/v1/ask`. Enabling cache without the revocation hook would
// regress DESIGN §4.5's "≤2s revocation" guarantee.

import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";

const isDev = env.NODE_ENV !== "production";

const githubClientId = isDev ? env.OAUTH_GITHUB_CLIENT_ID_DEV : env.OAUTH_GITHUB_CLIENT_ID;
const githubClientSecret = isDev
  ? env.OAUTH_GITHUB_CLIENT_SECRET_DEV
  : env.OAUTH_GITHUB_CLIENT_SECRET;

export const auth = betterAuth({
  // baseURL is documentation + defense against future proxy / preview
  // edge cases. Cloudflare Workers preserves Host so request introspection
  // works today — explicit beats inferred.
  baseURL: isDev ? "http://localhost:8787" : "https://app.nlqdb.com",
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  database: {
    dialect: new D1Dialect({ database: env.DB }),
    type: "sqlite",
  },
  // DESIGN §4.1: "No passwords, ever." Better Auth's email-password
  // is opt-in (not on by default), but we lock it explicitly so a
  // future contributor can't enable it without removing this line
  // and confronting the design choice.
  emailAndPassword: { enabled: false },
  socialProviders: {
    github: {
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  trustedOrigins: isDev
    ? ["http://localhost:8787", "http://localhost:4321"]
    : ["https://app.nlqdb.com", "https://nlqdb.com"],
});
