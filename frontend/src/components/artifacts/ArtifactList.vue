<script setup lang="ts">
import { computed } from 'vue';
import type { ArtifactModel } from '../../types/plugins';

const props = defineProps<{ artifacts: ArtifactModel[] }>();
const artifacts = computed(() => props.artifacts);
const emit = defineEmits<{ (e: 'select', id: string): void }>();
</script>

<template>
  <div class="artifact-grid">
    <article v-for="artifact in artifacts" :key="artifact.id" class="artifact-card">
      <header>
        <h3>{{ artifact.displayName }}</h3>
        <span class="badge">{{ artifact.pluginKey }}</span>
      </header>
      <p>Source: {{ artifact.source?.name }}</p>
      <p v-if="artifact.lastVersion">Version: {{ artifact.lastVersion.version }}</p>
      <button type="button" @click="emit('select', artifact.id)">Inspect</button>
    </article>
  </div>
</template>

<style scoped>
.artifact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}

.artifact-card {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.badge {
  background: #dbeafe;
  color: #1d4ed8;
  border-radius: 999px;
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

button {
  align-self: flex-start;
  border: none;
  background: #2563eb;
  color: #fff;
  padding: 0.35rem 0.9rem;
  border-radius: 0.375rem;
  cursor: pointer;
}
</style>
