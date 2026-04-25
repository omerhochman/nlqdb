# Plain HTML

The whole app is one file. No build step, no framework, no package manager.

## Run it

1. Replace `pk_live_REPLACE_ME` with your key (from `nlq keys create pk` or the chat's "Copy snippet" button).
2. Open `index.html` in a browser. Done.

Or serve it:

```bash
python3 -m http.server      # http://localhost:8000
# or
npx serve .
```

## Ship it

Drop the file on Cloudflare Pages, GitHub Pages, Netlify drop, S3, your own VPS — anywhere static HTML lives. There is no backend to deploy.

## Why it works

`<nlq-data>` and `<nlq-action>` are custom elements registered by `https://elements.nlqdb.com/v1.js`. They handle fetching, rendering, refresh, and the `on-success` lifecycle. Your form's field names (`customer`, `drink`, `total`) are inferred into columns automatically (DESIGN §3.5).

This is exactly the `DESIGN.md` §16 hello-world — the simplest possible nlqdb integration.
