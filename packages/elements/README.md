# @nlqdb/elements

`<nlq-data>` and (eventually) `<nlq-action>` custom elements — the
"drop one HTML tag, get a backend" surface from
[DESIGN §3.5](../../DESIGN.md) and [§14.5](../../DESIGN.md).

## What's in v0.1 (Slice 10)

- `<nlq-data>` custom element with `goal`, `db`, `query`, `api-key`,
  `endpoint`, `template`, `refresh` attributes.
- Live `POST /v1/ask` integration. Default endpoint
  `https://app.nlqdb.com/v1/ask`; override with `endpoint=` for
  self-hosted / preview deploys.
- Three client-side templates: `table`, `list`, `kv`.
- Public `el.refresh()` for imperative reload.
- Events: `nlq-data:load` on success, `nlq-data:error` on failure
  (`network` / `auth` / `api`). Both bubble + compose.
- Default `aria-live="polite"` on the host so state transitions
  are announced; opt out by setting your own value.
- Single-file ESM build at `dist/v1.js` for CDN distribution.

## Authentication

Two paths:

1. **`pk_live_*` publishable key** (Slice 11, the path real embeds
   should use). Sent as `Authorization: Bearer <key>`. Read-only,
   per-DB, origin-pinned, rate-limited.
2. **Same-origin cookie session** (Better Auth `__Host-session`).
   Only works when the page that hosts `<nlq-data>` is on
   `app.nlqdb.com` itself — host-only cookies are not transmitted
   cross-origin even with `credentials: include`. Useful for
   internal tools, not for marketing pages.

Until Slice 11 lands `pk_live_*` issuance, cross-origin embeds will
401 — the bearer is sent but the API ignores it today. The element's
markup states this honestly via the `nlq-data:error` event +
`data-kind="auth"` placeholder.

> [!WARNING]
> Never bind `endpoint=` to user-controlled input (URL params, CMS
> fields, etc.). The element sends your `api-key` as `Authorization:
> Bearer …` to whatever URL the attribute resolves to. The element
> warns to console when an api-key is sent over plain http, but only
> the developer can prevent injection.

## What's NOT in v0.1 (Slice 11+)

- `pk_live_*` publishable key issuance + origin-pinning.
- `<nlq-action>` writes counterpart.
- Server-side template rendering (the `render: "html"` API path
  from DESIGN §3.5).
- `card-grid` and `chart` templates.
- SSE auto-upgrade.
- Error backoff during refresh polling (today: hammers at the
  configured cadence regardless of failure).

## Usage

CDN script tag (third-party sites):

```html
<script src="https://elements.nlqdb.com/v1.js" type="module"></script>

<nlq-data
  goal="the 5 most-loved coffee shops in Berlin"
  db="coffee"
  api-key="pk_live_..."
  template="table"
  refresh="60s"
></nlq-data>
```

Workspace import (Astro / Next / SolidStart inside this monorepo):

```ts
import "@nlqdb/elements";
```

The first import on a page registers `<nlq-data>` on
`customElements`; subsequent imports are a no-op.

### Events

```js
const el = document.querySelector("nlq-data");
el.addEventListener("nlq-data:load", (e) => {
  // e.detail = { rows: number, cached: boolean }
});
el.addEventListener("nlq-data:error", (e) => {
  // e.detail.kind = "network" | "auth" | "api"
  // for "api": e.detail.status (HTTP), e.detail.error (slug or { status, … })
});
```

### Imperative reload

```js
document.querySelector("nlq-data").refresh();
```

Coalesces with any pending attribute change (one fetch per microtask).

## Local dev

```bash
bun run --cwd packages/elements typecheck
bun run --cwd packages/elements test
bun run --cwd packages/elements build      # produces dist/v1.js
```

## Bundle budget

DESIGN §3.5 caps the CDN bundle at < 6 KB gzipped. Verify after
build with `gzip -c dist/v1.js | wc -c`. CI fails the build if the
gzipped size reaches 6144 bytes.
