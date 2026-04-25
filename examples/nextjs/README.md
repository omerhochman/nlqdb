# Next.js (App Router)

The integration is `<nlq-data>` dropped into a server component. No `'use client'` directive needed — the element hydrates on its own once `elements.nlqdb.com/v1.js` loads.

## Run it

```bash
npx create-next-app@latest nlqdb-orders --ts --app --no-tailwind --no-src-dir
cd nlqdb-orders
```

Replace `app/page.tsx` with the file in this folder, then:

```bash
echo "NEXT_PUBLIC_NLQDB_KEY=pk_live_yourkey" > .env.local
npm run dev
```

## Notes

- **`'use client'`** is intentionally absent. Server components emit the markup; the browser-side runtime in `elements.nlqdb.com/v1.js` upgrades the custom elements after hydration.
- **`next/script` with `strategy="afterInteractive"`** is the Next-idiomatic way to load a third-party module script after hydration. Don't put a raw `<script>` in JSX — Next strips it during SSR.
- The TypeScript declaration at the top of `page.tsx` will go away once `@nlqdb/elements` publishes its own `.d.ts` (Phase 1).
- For server-side calls (e.g. an RSC that pre-fetches data with a `sk_live_…`), use `@nlqdb/sdk` from a route handler instead — coming with the SDK in Phase 1.
