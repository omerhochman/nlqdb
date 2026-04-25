# Nuxt 3 (Vue 3)

Vue's template compiler treats unknown tags as native custom elements without any `compilerOptions.isCustomElement` configuration — `<nlq-data>` is rendered untransformed.

## Run it

```bash
npx nuxi@latest init nlqdb-orders
cd nlqdb-orders
```

Replace `app.vue` with the file in this folder, then:

```bash
echo "NUXT_PUBLIC_NLQDB_KEY=pk_live_yourkey" > .env
npm install && npm run dev
```

Add the public runtime config in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: { nlqdbKey: "" },   // overridden by NUXT_PUBLIC_NLQDB_KEY
  },
});
```

## Notes

- **`useHead`** is the Nuxt-idiomatic way to inject a third-party `<script>`. It dedupes across navigations and SSRs cleanly.
- **`:api-key`** uses the Vue dynamic-attribute syntax so the value flows from runtime config.
- For Nuxt 4 the file is the same; the `app.vue` location moves under `app/` but the integration code is identical.
