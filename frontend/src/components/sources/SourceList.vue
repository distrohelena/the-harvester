<script setup lang="ts">
import { computed } from 'vue';
import type { SourceModel } from '../../types/plugins';

const props = defineProps<{
  sources: SourceModel[];
}>();

const sources = computed(() => props.sources);

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'delete', id: string): void;
}>();
</script>

<template>
  <table class="source-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Plugin</th>
        <th>Schedule</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="source in sources" :key="source.id">
        <td>
          <button type="button" @click="emit('select', source.id)">{{ source.name }}</button>
        </td>
        <td>{{ source.pluginKey }}</td>
        <td>{{ source.scheduleCron ?? '—' }}</td>
        <td>
          <span :class="['badge', source.isActive ? 'active' : 'inactive']">
            {{ source.isActive ? 'Active' : 'Paused' }}
          </span>
        </td>
        <td>
          <button type="button" class="danger" @click="emit('delete', source.id)">Delete</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.source-table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.75rem;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
}

button {
  border: none;
  background: none;
  cursor: pointer;
  color: #2563eb;
}

button.danger {
  color: #dc2626;
}

.badge {
  display: inline-flex;
  padding: 0.25rem 0.5rem;
  border-radius: 999px;
  font-size: 0.85rem;
}

.active {
  background: #d1fae5;
  color: #065f46;
}

.inactive {
  background: #fee2e2;
  color: #991b1b;
}
</style>
