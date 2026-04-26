import type { APIRoute } from "astro";

// Hand-rolled sitemap. The official `@astrojs/sitemap` integration
// auto-generates one from the page list, but a single-page site
// doesn't justify the dependency. When `/pricing`, `/manifesto`, etc.
// land, switch to the integration in one go.

const SITE = "https://nlqdb.com";
const ROUTES = ["/"];

export const GET: APIRoute = () => {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ROUTES.map((path) => `  <url><loc>${SITE}${path}</loc></url>`).join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
