# apps/web — Astro coming-soon site

Phase 1. Static-first Astro deployed via Cloudflare **Workers Static
Assets** (migrated off Pages 2026-04-27 in PR #49). Lighthouse target
100/100/100/100 (PLAN §1.1, DESIGN §3.1).

After PR #49's pivot, this is a coming-soon-style site rather than a
signed-in chat surface. The chat surface (and the magic-link / OAuth
sign-in UI that fed it) is tabled while the UX is reworked; the
backend at `app.nlqdb.com` (`/v1/chat/messages`, `/v1/anon/adopt`,
`/api/auth/*`) is intact and dormant.

Currently shipping:

- `/` — wordmark + lede + auto-sliding 20-slide capability carousel
  + waitlist form (POST `/v1/waitlist`).
- `/manifesto` — long-form philosophy.
- `robots.txt`, `llms.txt`, hand-rolled `sitemap.xml`.
- JSON-LD `SoftwareApplication` on every page via `Base.astro`.
- Live `<nlq-data>` demo on the homepage hero, backed by
  `/v1/demo/ask`.

Tabled (Phase 1.x or Phase 2):

- `/sign-in`, `/app`, `/auth/continue` — chat surface + magic-link UI.
- `/pricing`, `/docs`, `/blog`, `/showcase`.
- View Transitions morph from hero into chat (chat tabled).

## Local dev

```bash
bun install --cwd apps/web
bun run --cwd apps/web dev      # http://localhost:4321
bun run --cwd apps/web check    # astro check (typecheck)
bun run --cwd apps/web build    # static dist/
bun run --cwd apps/web preview  # serve dist/
```

## Deploy

Static `dist/` deployed to a Cloudflare **Worker** (`nlqdb-web`) via
Workers Static Assets. Configured in `wrangler.toml`. The Worker is
reachable at `nlqdb-web.<account>.workers.dev`; the DNS flip moving
`nlqdb.com` from the (now empty-domain) `nlqdb-coming-soon` Pages
project to this Worker is in progress — see [RUNBOOK §6](../../RUNBOOK.md).

```bash
bun run --cwd apps/web deploy
```

PR previews use Workers Versions with `--preview-alias pr-N`,
producing sticky `pr-N-nlqdb-web.<account>.workers.dev` URLs.

## Design tokens

`src/styles/global.css` — neo-brutalist + terminal per DESIGN §3.1:
Acid Lime `#C6F432` on near-black `#0B0F0A`, JetBrains Mono headlines,
3px borders, 6px hard shadows, no rounding.
