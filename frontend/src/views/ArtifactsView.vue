<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import ArtifactList from '../components/artifacts/ArtifactList.vue';
import { fetchArtifacts } from '../api/artifacts';
import { usePluginsStore } from '../stores/plugins';

import type { ArtifactModel } from '../types/plugins';

const router = useRouter();
const pluginsStore = usePluginsStore();
const state = reactive<{
  artifacts: ArtifactModel[];
  loading: boolean;
  total: number;
  search: string;
  pluginKey: string;
}>({
  artifacts: [],
  loading: false,
  total: 0,
  search: '',
  pluginKey: ''
});

async function loadArtifacts() {
  state.loading = true;
  try {
    const response = await fetchArtifacts({ search: state.search, pluginKey: state.pluginKey });
    state.artifacts = response.items;
    state.total = response.total;
  } finally {
    state.loading = false;
  }
}

function openArtifact(id: string) {
  router.push(`/artifacts/${id}`);
}

onMounted(async () => {
  await Promise.all([pluginsStore.loadPlugins(), loadArtifacts()]);
});
</script>

<template>
  <section class="artifacts-view">
    <header>
      <h2>Artifacts</h2>
      <input v-model="state.search" placeholder="Search" @keyup.enter="loadArtifacts" />
      <select v-model="state.pluginKey" @change="loadArtifacts">
        <option value="">All plugins</option>
        <option v-for="plugin in pluginsStore.plugins" :key="plugin.key" :value="plugin.key">
          {{ plugin.name }}
        </option>
      </select>
      <button type="button" @click="loadArtifacts">Refresh</button>
    </header>

    <ArtifactList :artifacts="state.artifacts" @select="openArtifact" />
    <p>{{ state.total }} artifacts</p>
  </section>
</template>

<style scoped>
header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1.5rem;
}

input,
select,
button {
  border-radius: 0.375rem;
  border: 1px solid #d1d5db;
  padding: 0.45rem 0.7rem;
}

button {
  background: #2563eb;
  color: #fff;
  border: none;
}
</style>
