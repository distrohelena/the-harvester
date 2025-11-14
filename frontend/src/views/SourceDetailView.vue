<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SourceForm from '../components/sources/SourceForm.vue';
import NavigationRenderer from '../components/navigation/NavigationRenderer.vue';
import { fetchSource, updateSource, enqueueRun } from '../api/sources';
import { fetchNavigation } from '../api/navigation';
import { usePluginsStore } from '../stores/plugins';
import type { SourceModel } from '../types/plugins';

const route = useRoute();
const id = route.params.id as string;
const pluginsStore = usePluginsStore();
const source = ref<SourceModel>();
const draft = ref<Partial<SourceModel>>();
const loading = ref(false);
const navigation = ref();
const running = ref(false);

async function load() {
  loading.value = true;
  try {
    const [sourcePayload, navigationPayload] = await Promise.all([
      fetchSource(id),
      fetchNavigation(id).catch(() => ({ nodes: [] }))
    ]);
    source.value = sourcePayload;
    draft.value = { ...sourcePayload };
    navigation.value = navigationPayload;
  } finally {
    loading.value = false;
  }
}

async function handleSubmit(event: Event) {
  event.preventDefault();
  if (!draft.value) return;
  loading.value = true;
  try {
    await updateSource(id, draft.value);
    await load();
  } finally {
    loading.value = false;
  }
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
    <section>
      <header>
        <div>
          <h2>{{ source.name }}</h2>
          <p>Plugin: {{ source.pluginKey }}</p>
        </div>
        <button type="button" @click="triggerRun" :disabled="running">{{ running ? 'Queueing…' : 'Run Now' }}</button>
      </header>

      <form @submit="handleSubmit">
        <SourceForm v-if="draft" :plugins="pluginsStore.plugins" v-model="draft" :submitting="loading" />
      </form>
    </section>

    <aside>
      <h3>Navigation</h3>
      <NavigationRenderer :schema="pluginsStore.findPlugin(source.pluginKey)?.navigationSchema" :payload="navigation" />
    </aside>
  </div>
</template>

<style scoped>
.source-detail {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 2rem;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

button {
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1.2rem;
  background: #10b981;
  color: #fff;
}

aside {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem;
  background: #fff;
}
</style>
