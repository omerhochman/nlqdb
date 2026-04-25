# nlqdb — examples

Smallest-scaffold integrations of nlqdb in popular frontends + a CLI-only path. Each folder is one file's worth of business logic on top of whatever the framework needs to render it.

## Folders

| Path                              | Stack                  | Lines (excluding boilerplate) |
| :-------------------------------- | :--------------------- | :---------------------------- |
| [`html/`](./html)                 | Plain HTML, no build   | 17                            |
| [`nextjs/`](./nextjs)             | Next.js (React, App Router) | 11                       |
| [`nuxt/`](./nuxt)                 | Nuxt 3 (Vue 3)         | 10                            |
| [`sveltekit/`](./sveltekit)       | SvelteKit              | 11                            |
| [`astro/`](./astro)               | Astro                  | 12                            |
| [`cli/`](./cli)                   | Bash + `nlq`           | 4 commands, no frontend       |

Every framework example does the same thing: render today's orders as a live-refreshing table, in 1 file. The variance is the framework's surrounding files — the **nlqdb integration is identical**: include the `<nlq-data>` element from `elements.nlqdb.com/v1.js`, set `goal` + `api-key`, done.

## Status

> Phase 0 (Slice 4) — `apps/api` ships in Slices 6–7 and `@nlqdb/elements` ships in Phase 1.
> Until then these examples document the call shapes the slices are building toward — they parse, type-check, and embed in the listed framework, but the live runtime is not wired yet. Once Phase 1 lands, every example will run end-to-end with no edits.

Each folder's `README.md` includes:

- The 3-step "scaffold + drop in this file + run" recipe.
- The exact `<nlq-data>` snippet — same in every example, deliberately.
- A pointer to the framework-native idiom (e.g. how Astro hydrates custom elements, how Next.js handles `'use client'`).

## Authentication

Every example uses a publishable key (`pk_live_…`) inlined into the HTML/JSX/template. That's by design: publishable keys are read-only, origin-pinned, and meant for client-side embed (DESIGN §4.1). For server-side usage where a `sk_live_…` is required, see `examples/cli/` and the (forthcoming) `@nlqdb/sdk` snippets.

To get a key, after Phase 1 lands:

```bash
nlq login          # one click in browser
nlq keys create pk # prints pk_live_…
```

Or use anonymous mode (DESIGN §3.3): no sign-in, DB lives 72 h, adopt later via `nlq login`.

## Contributing a new example

PRs welcome — especially for stacks not yet here (SolidStart, TanStack Start, Qwik, React Native, Expo, Tauri, etc.) and creative use-cases (Discord bot, GitHub Action, browser extension, weekly digest cron). Keep each example to one source file plus a 10-line README. Same `<nlq-data>` snippet across all of them — that's the point.

The full target list — every framework, mobile platform, server middleware, IDE extension, no-code platform, iPaaS, analytics tool, and chat integration we plan to ship into — lives in [`IMPLEMENTATION.md` §10](../IMPLEMENTATION.md#10-platform-integrations--the-matrix). Each row there is a future 1st-party or 3rd-party integration; this folder is where the templated 2nd-party versions live.
