<script setup lang="ts">
import type { NavigationPayload } from '../../api/navigation';
defineOptions({ name: 'DocsNavigationView' });

const props = defineProps<{ payload?: NavigationPayload }>();

const nodes = props.payload?.nodes ?? [];
</script>

<template>
  <div class="docs-nav">
    <ul>
      <li v-for="node in nodes" :key="node.id ?? node.label">
        <span>{{ node.label }}</span>
        <DocsNavigationView v-if="node.children?.length" :payload="{ nodes: node.children }" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
ul {
  list-style: none;
  padding-left: 1rem;
}

li {
  margin-bottom: 0.3rem;
}

span {
  font-weight: 500;
}
</style>
