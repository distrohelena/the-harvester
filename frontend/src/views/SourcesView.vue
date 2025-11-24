<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import SourceList from '../components/sources/SourceList.vue';
import SourceForm from '../components/sources/SourceForm.vue';
import { fetchSources, createSource, deleteSource } from '../api/sources';
import { useRouter } from 'vue-router';
import { usePluginsStore } from '../stores/plugins';
import type { SourceModel } from '../types/plugins';

const router = useRouter();
const pluginsStore = usePluginsStore();
const state = reactive({
  search: '',
  loading: false,
  sources: [] as SourceModel[],
  total: 0
});
const draft = ref<Partial<SourceModel>>({ options: {}, isActive: true });
const submitting = ref(false);

async function loadSources() {
  state.loading = true;
  try {
    const response = await fetchSources({ search: state.search });
    state.sources = response.items;
    state.total = response.total;
  } finally {
    state.loading = false;
  }
}

async function handleSubmit(event: Event) {
  event.preventDefault();
  submitting.value = true;
  try {
    await createSource(draft.value);
    draft.value = { options: {}, isActive: true };
    await loadSources();
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(id: string) {
  if (!window.confirm('Delete this source?')) return;
  await deleteSource(id);
  await loadSources();
}

function handleSelect(id: string) {
  router.push(`/sources/${id}`);
}

onMounted(async () => {
  await Promise.all([pluginsStore.loadPlugins(), loadSources()]);
});
</script>

<template>
  <div class="sources-view">
    <section class="cards-panel">
      <div class="panel__header">
        <h2>Sources</h2>
        <input v-model="state.search" placeholder="Search" @keyup.enter="loadSources" />
        <button type="button" @click="loadSources" :disabled="state.loading">Refresh</button>
      </div>
      <div class="panel__body">
        <SourceList :sources="state.sources" @select="handleSelect" @delete="handleDelete" />
        <p v-if="!state.loading">{{ state.total }} total sources</p>
      </div>
    </section>

    <section class="create-panel">
      <div class="create-panel__header">
        <h2>Create Source</h2>
      </div>
      <div class="create-panel__body">
        <form @submit="handleSubmit">
          <SourceForm
            :plugins="pluginsStore.plugins"
            v-model="draft"
            :submitting="submitting"
          />
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sources-view {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 2rem;
}

.panel__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

input {
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
}

button {
  border: none;
  background: #2563eb;
  color: #fff;
  padding: 0.4rem 1rem;
  border-radius: 0.375rem;
}

/* Keep the list card aligned with the Create panel height so scrolling happens inside each column rather than the page. */
.cards-panel {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #fff;
  height: calc(100vh - var(--title-bar-size, 48px) - 2rem - 1rem);
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 1rem 1.25rem;
}

.panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* Tie into the global layout math so the panel height mirrors plugin rectangles: reserve the title bar + 2rem padding, then subtract the explicit bottom margin so it stays visually consistent. */
.create-panel {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #fff;
  height: calc(100vh - var(--title-bar-size, 48px) - 2rem - 1rem);
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.create-panel__header {
  padding: 1rem 1.25rem 0.5rem;
  border-bottom: 1px solid #f3f4f6;
}

.create-panel__body {
  padding: 1rem 1.25rem;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
