// Shared vitest setup — replaces the Better Auth singleton with a stub
// so any test that imports the worker (`../src/index.ts`) can run.
//
// `apps/api/src/auth.ts` does `import { env } from "cloudflare:workers"`
// at module load to wire the singleton against real bindings. Vitest
// has no `cloudflare:workers` virtual module — without this mock, the
// import fails the moment any test file pulls in `../src/index.ts`.
//
// Tests that exercise the auth wrapper (`auth.test.ts`) control the
// stub by re-importing `../src/auth.ts` (which returns the mock here)
// and calling `auth.handler.mockResolvedValue(...)` per case.

import { vi } from "vitest";

vi.mock("../src/auth.ts", () => ({
  auth: {
    handler: vi.fn(async () => new Response(null, { status: 200 })),
  },
}));
