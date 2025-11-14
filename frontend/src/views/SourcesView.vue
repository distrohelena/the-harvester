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
    <section>
      <header>
        <h2>Sources</h2>
        <input v-model="state.search" placeholder="Search" @keyup.enter="loadSources" />
        <button type="button" @click="loadSources" :disabled="state.loading">Refresh</button>
      </header>
      <SourceList :sources="state.sources" @select="handleSelect" @delete="handleDelete" />
      <p v-if="!state.loading">{{ state.total }} total sources</p>
    </section>

    <section>
      <h2>Create Source</h2>
      <form @submit="handleSubmit">
        <SourceForm :plugins="pluginsStore.plugins" v-model="draft" :submitting="submitting" />
      </form>
    </section>
  </div>
</template>

<style scoped>
.sources-view {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 2rem;
}

header {
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
</style>
