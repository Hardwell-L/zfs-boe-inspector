<script setup lang="ts">
import { ref } from 'vue';
defineProps<{ summary: string }>();
const open = ref(false);
function onToggle(event: globalThis.Event) {
  open.value = (event.currentTarget as globalThis.HTMLDetailsElement).open;
}
</script>

<template>
  <details @toggle="onToggle">
    <summary>{{ summary }}</summary>
    <slot v-if="open" />
  </details>
</template>

<style scoped>
summary { cursor: pointer; }
</style>
