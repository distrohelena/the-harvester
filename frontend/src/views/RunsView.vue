<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { fetchRuns } from '../api/runs';
import type { ExtractionRunModel } from '../api/runs';

const state = reactive<{ runs: ExtractionRunModel[]; loading: boolean }>({
  runs: [],
  loading: false
});

async function loadRuns() {
  state.loading = true;
  try {
    const response = await fetchRuns();
    state.runs = response.items;
  } finally {
    state.loading = false;
  }
}

onMounted(loadRuns);
</script>

<template>
  <section>
    <header>
      <h2>Extraction Runs</h2>
      <button type="button" @click="loadRuns" :disabled="state.loading">Refresh</button>
    </header>
    <table>
      <thead>
        <tr>
          <th>Source</th>
          <th>Status</th>
          <th>Started</th>
          <th>Finished</th>
          <th>Stats</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="run in state.runs" :key="run.id">
          <td>{{ run.source.name }}</td>
          <td>{{ run.status }}</td>
          <td>{{ run.startedAt ? new Date(run.startedAt).toLocaleString() : '—' }}</td>
          <td>{{ run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '—' }}</td>
          <td>{{ run.createdArtifacts }} new / {{ run.updatedArtifacts }} updated / {{ run.skippedArtifacts }} skipped</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

button {
  border: none;
  background: #2563eb;
  color: #fff;
  border-radius: 0.375rem;
  padding: 0.4rem 1rem;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.75rem;
  border-bottom: 1px solid #e5e7eb;
}
</style>
