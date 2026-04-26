import { defineConfig } from "astro/config";

// Static-first marketing site. No adapter — `astro build` emits a
// static `dist/` that Cloudflare Pages serves at the edge. `site` is
// the absolute origin used for canonical URLs and the sitemap.
//
// Phase 1 deploys to a dedicated Pages project (`nlqdb-web`) while
// `apps/coming-soon` keeps serving `nlqdb.com`. The DNS flip happens
// in a later slice once the marketing site is content-complete.
export default defineConfig({
  site: "https://nlqdb.com",
  prefetch: true,
});
