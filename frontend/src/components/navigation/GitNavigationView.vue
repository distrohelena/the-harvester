<script setup lang="ts">
import type { NavigationPayload } from '../../api/navigation';

defineOptions({ name: 'GitNavigationView' });
const props = defineProps<{ payload?: NavigationPayload }>();
const nodes = props.payload?.nodes ?? [];
</script>

<template>
  <div class="timeline">
    <article v-for="node in nodes" :key="node.id ?? node.label" class="timeline-entry">
      <h4>{{ node.label }}</h4>
      <p v-if="node.data?.message">{{ node.data.message }}</p>
      <small v-if="node.data?.timestamp">{{ new Date(node.data.timestamp).toLocaleString() }}</small>
    </article>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.timeline-entry {
  border-left: 3px solid #2563eb;
  padding-left: 1rem;
}

h4 {
  margin: 0;
}

p {
  margin: 0.2rem 0;
}
</style>
