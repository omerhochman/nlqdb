<!--
  app.vue — Nuxt 3.

  `useHead` injects the elements.nlqdb.com script tag into <head>.
  Vue treats unknown elements as custom elements automatically, so
  <nlq-data> just works in the template.
-->

<script setup lang="ts">
useHead({
  script: [{ src: "https://elements.nlqdb.com/v1.js", type: "module" }],
});

const apiKey = useRuntimeConfig().public.nlqdbKey ?? "pk_live_REPLACE_ME";
</script>

<template>
  <main>
    <h1>Today's orders</h1>
    <nlq-data
      goal="today's orders, newest first"
      :api-key="apiKey"
      template="table"
      refresh="5s"
    />
  </main>
</template>
