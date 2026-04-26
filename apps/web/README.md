# apps/web — Astro marketing site

Phase 1. Static-first Astro on Cloudflare Pages. Lighthouse target
100/100/100/100 (PLAN §1.1, DESIGN §3.1).

Currently shipping:

- `/` — hero with goal-first input (cycling persona placeholders),
  definition-lead copy, GitHub + design CTAs.
- `robots.txt` — AI-permissive (DESIGN §3.1, AEO/GEO).
- `llms.txt` — model-readable summary (https://llmstxt.org).
- `sitemap.xml` — hand-rolled (one route today; switch to
  `@astrojs/sitemap` once the page count justifies the dep).
- JSON-LD `SoftwareApplication` on every page via `Base.astro`.

Not yet shipping (subsequent slices):

- `/pricing`, `/manifesto`, `/docs`, `/blog`, `/showcase`.
- View Transitions morph from hero input into the chat surface.
- Live query ticker, GitHub star count, scroll-driven schema-build story.
- The chat surface itself at `app.nlqdb.com` (separate Astro route +
  React island per DESIGN §3.2).

## Local dev

```bash
bun --cwd apps/web install
bun --cwd apps/web run dev      # http://localhost:4321
bun --cwd apps/web run check    # astro check (typecheck)
bun --cwd apps/web run build    # static dist/
bun --cwd apps/web run preview  # serve dist/
```

## Deploy

Static `dist/` to a dedicated Cloudflare Pages project
(`nlqdb-web`). The DNS flip from `apps/coming-soon` to this project
happens in a later slice once the marketing site is content-complete
— until then the project lives at `nlqdb-web.pages.dev` while
`apps/coming-soon` keeps serving `nlqdb.com`.

```bash
bun --cwd apps/web run deploy
```

First deploy creates the Pages project. Subsequent deploys upload
to the same project and produce a preview URL per branch.

## Design tokens

`src/styles/global.css` — neo-brutalist + terminal per DESIGN §3.1:
Acid Lime `#C6F432` on near-black `#0B0F0A`, JetBrains Mono headlines,
3px borders, 6px hard shadows, no rounding.
