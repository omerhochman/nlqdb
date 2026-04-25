// app/page.tsx — Next.js App Router (Next 14+).
//
// Custom elements work on the server, but `<script>` tags inside JSX
// don't auto-execute on the client. We use next/script with
// strategy="afterInteractive" so elements.nlqdb.com is loaded after
// hydration and `<nlq-data>` upgrades in place.
//
// `'use client'` is NOT required — the page is plain HTML.

import Script from "next/script";
import type { JSX } from "react";

// Tell TS about the custom elements once at the top of the file. When
// `@nlqdb/elements` ships its `.d.ts`, this declaration goes away.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "nlq-data": {
        goal: string;
        "api-key": string;
        template?: "table" | "list" | "kv" | "card-grid";
        refresh?: string;
      };
    }
  }
}

export default function Page(): JSX.Element {
  return (
    <>
      <Script
        src="https://elements.nlqdb.com/v1.js"
        type="module"
        strategy="afterInteractive"
      />
      <main>
        <h1>Today's orders</h1>
        <nlq-data
          goal="today's orders, newest first"
          api-key={process.env.NEXT_PUBLIC_NLQDB_KEY ?? "pk_live_REPLACE_ME"}
          template="table"
          refresh="5s"
        />
      </main>
    </>
  );
}
