# SvelteKit

Svelte's compiler passes unknown tags through to the DOM unchanged, so `<nlq-data>` is a one-liner — no plugin config, no runtime detection.

## Run it

```bash
npx sv create nlqdb-orders        # pick "minimal" + TypeScript
cd nlqdb-orders
```

Replace `src/routes/+page.svelte` with the file in this folder, then:

```bash
echo "PUBLIC_NLQDB_KEY=pk_live_yourkey" > .env
npm install && npm run dev
```

## Notes

- **`<svelte:head>`** is the SvelteKit-idiomatic place for a third-party `<script>`; SSR injects it before any client code runs.
- **`PUBLIC_NLQDB_KEY`** uses SvelteKit's `$env/static/public` to make the key build-time-typed and bundle-safe (only `PUBLIC_*` env vars ever reach the client).
- Svelte 5 vs 4: this file works on both — the `<script>` block is unchanged. Custom elements have always passed through the Svelte compiler.
