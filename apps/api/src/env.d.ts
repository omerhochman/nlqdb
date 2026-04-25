// Typed shape for the bindings + secrets `apps/api` expects at runtime.
//
// `@cloudflare/workers-types` types `cloudflare:workers`'s top-level `env`
// import as the global `Cloudflare.Env` interface; we augment that
// interface here so `import { env } from "cloudflare:workers"` autocompletes
// our specific bindings and secrets.
//
// Cloudflare's "no I/O outside request context" rule still applies — we may
// reference bindings (e.g. `env.DB`) at module load, but methods that hit
// the network (`env.DB.prepare(...)`) must wait for a request.

declare global {
  namespace Cloudflare {
    interface Env {
      NODE_ENV?: string;

      DB: D1Database;
      KV: KVNamespace;

      BETTER_AUTH_SECRET: string;

      OAUTH_GITHUB_CLIENT_ID: string;
      OAUTH_GITHUB_CLIENT_SECRET: string;
      OAUTH_GITHUB_CLIENT_ID_DEV: string;
      OAUTH_GITHUB_CLIENT_SECRET_DEV: string;

      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;

      GRAFANA_OTLP_ENDPOINT?: string;
      GRAFANA_OTLP_AUTHORIZATION?: string;
    }
  }
}

export {};
