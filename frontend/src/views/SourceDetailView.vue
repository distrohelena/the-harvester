<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SourceForm from '../components/sources/SourceForm.vue';
import { fetchSource, updateSource, enqueueRun } from '../api/sources';
import { usePluginsStore } from '../stores/plugins';
import type { SourceModel } from '../types/plugins';

const route = useRoute();
const id = route.params.id as string;
const pluginsStore = usePluginsStore();
const source = ref<SourceModel>();
const draft = ref<Partial<SourceModel>>();
const loading = ref(false);
const running = ref(false);

async function load() {
  loading.value = true;
  try {
    const sourcePayload = await fetchSource(id);
    source.value = sourcePayload;
    draft.value = { ...sourcePayload };
  } finally {
    loading.value = false;
  }
}

async function handleSubmit(event: Event) {
  event.preventDefault();
  if (!draft.value) return;
  loading.value = true;
  try {
    const payload = buildUpdatePayload(draft.value);
    await updateSource(id, payload);
    await load();
  } finally {
    loading.value = false;
  }
}

function buildUpdatePayload(sourceDraft: Partial<SourceModel>) {
  return {
    name: sourceDraft.name,
    pluginKey: sourceDraft.pluginKey,
    options: sourceDraft.options ?? {},
    scheduleCron: sourceDraft.scheduleCron,
    isActive: sourceDraft.isActive
  };
}

async function triggerRun() {
  running.value = true;
  try {
    await enqueueRun(id);
    alert('Extraction queued');
  } finally {
    running.value = false;
  }
}

onMounted(async () => {
  await Promise.all([pluginsStore.loadPlugins(), load()]);
});
</script>

<template>
  <div v-if="loading && !source">Loading…</div>
  <div v-else-if="source" class="source-detail">
    <section class="source-panel">
      <div class="source-panel__header">
        <div>
          <h2>{{ source.name }}</h2>
          <p>Plugin: {{ source.pluginKey }}</p>
        </div>
        <button type="button" @click="triggerRun" :disabled="running">
          {{ running ? 'Queueing…' : 'Run Now' }}
        </button>
      </div>

      <div class="source-panel__body">
        <form @submit="handleSubmit">
          <SourceForm
            v-if="draft"
            :plugins="pluginsStore.plugins"
            v-model="draft"
            :submitting="loading"
          />
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Match the global main height budget so the detail view never bleeds into the footer padding. */
.source-detail {
  height: calc(100vh - var(--title-bar-size, 48px) - 2rem);
  min-height: 0;
  display: flex;
}

/* Mirror the block treatment used on the list/create panels so the source editor feels consistent and scrolls internally. */
.source-panel {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #fff;
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 1rem 1.25rem;
}

.source-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.source-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

button {
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1.2rem;
  background: #10b981;
  color: #fff;
}
</style>
