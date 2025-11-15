<script setup lang="ts">
import { computed } from 'vue';
import type { ArtifactModel, ArtifactVersionModel } from '../../types/plugins';

const props = defineProps<{
  artifact: ArtifactModel;
  versions: ArtifactVersionModel[];
  selectedVersionId?: string;
}>();

const emit = defineEmits<{
  (e: 'selectVersion', id: string): void;
}>();

const selectedVersion = computed(() =>
  props.versions.find((version) => version.id === props.selectedVersionId) ?? props.artifact.lastVersion
);
</script>

<template>
  <div class="artifact-viewer">
    <aside>
      <h3>Versions</h3>
      <ul>
        <li
          v-for="version in versions"
          :key="version.id"
          :class="{ active: version.id === selectedVersion?.id }"
          @click="emit('selectVersion', version.id)"
        >
          {{ version.version }}
          <span>{{ new Date(version.createdAt).toLocaleString() }}</span>
        </li>
      </ul>
    </aside>
    <section>
      <header>
        <div>
          <h2>{{ artifact.displayName }}</h2>
          <p>Plugin: {{ artifact.pluginKey }} · Source: {{ artifact.source.name }}</p>
        </div>
      </header>
      <pre>{{ JSON.stringify(selectedVersion?.data ?? {}, null, 2) }}</pre>
    </section>
  </div>
</template>

<style scoped>
.artifact-viewer {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 1rem;
}

aside {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #fff;
  padding: 1rem;
}

aside ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

aside li {
  padding: 0.5rem;
  border-radius: 0.375rem;
  cursor: pointer;
}

aside li.active,
aside li:hover {
  background: #e0f2fe;
}

section {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 0.75rem 0.75rem 0.75rem 0.5rem;
  background: #fff;
}

pre {
  background: #0f172a;
  color: #f8fafc;
  border-radius: 0.5rem;
  padding: 0.75rem;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  width: 100%;
}
</style>
