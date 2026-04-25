# Astro

Astro's static-first rendering is a great fit for nlqdb-embedded pages — most of the markup is HTML, and the dynamic part lives inside `<nlq-data>` rather than a heavy client framework.

## Run it

```bash
npm create astro@latest nlqdb-orders -- --template minimal --typescript strict
cd nlqdb-orders
```

Replace `src/pages/index.astro` with the file in this folder, then:

```bash
echo "PUBLIC_NLQDB_KEY=pk_live_yourkey" > .env
npm install && npm run dev
```

## Notes

- **`is:inline`** on the `<script>` tells Astro not to bundle / process the import — the elements package is loaded directly from `elements.nlqdb.com`, so we want it as-is.
- **`PUBLIC_*` env prefix** is Astro-mandated for any env var the browser sees.
- This is the same pattern `apps/web` (the `nlqdb.com` marketing site) will use — Astro is the in-house frontend framework.
