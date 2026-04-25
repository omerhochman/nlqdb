<!--
  src/routes/+page.svelte — SvelteKit.

  Svelte 5 lets <svelte:head> inject the elements.nlqdb.com script tag.
  Custom elements are passed through the compiler verbatim, so
  <nlq-data> works without configuration.
-->

<script lang="ts">
  import { PUBLIC_NLQDB_KEY } from "$env/static/public";
  const apiKey = PUBLIC_NLQDB_KEY || "pk_live_REPLACE_ME";
</script>

<svelte:head>
  <script src="https://elements.nlqdb.com/v1.js" type="module"></script>
</svelte:head>

<main>
  <h1>Today's orders</h1>
  <nlq-data
    goal="today's orders, newest first"
    api-key={apiKey}
    template="table"
    refresh="5s"
  ></nlq-data>
</main>
