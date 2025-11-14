<script setup lang="ts">
import type { NavigationPayload } from '../../api/navigation';

defineOptions({ name: 'PlainWebsiteNavigationView' });
const props = defineProps<{ payload?: NavigationPayload }>();
const nodes = props.payload?.nodes ?? [];
</script>

<template>
  <ul class="page-list">
    <li v-for="node in nodes" :key="node.id ?? node.label">
      {{ node.label }}
    </li>
  </ul>
</template>

<style scoped>
.page-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

li {
  padding: 0.5rem 0;
  border-bottom: 1px solid #e5e7eb;
}
</style>
