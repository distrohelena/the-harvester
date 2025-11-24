<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SourceModel } from '../../types/plugins';

const props = defineProps<{
  sources: SourceModel[];
}>();

type SortKey = 'name' | 'pluginKey' | 'status';

const sortState = ref<{ key: SortKey; direction: 'asc' | 'desc' }>({
  key: 'name',
  direction: 'asc'
});

// Normalize each sortable field to a string so comparisons stay type-safe and we can reuse the same sorter for every column.
const getComparableValue = (source: SourceModel, key: SortKey): string => {
  if (key === 'status') {
    return source.isActive ? 'Active' : 'Paused';
  }
  if (key === 'pluginKey') {
    return source.pluginKey ?? '';
  }
  return source.name ?? '';
};

// Sort on the client so changing columns feels instant without re-fetching sources.
const sources = computed(() => {
  const data = [...props.sources];
  const { key, direction } = sortState.value;
  const factor = direction === 'asc' ? 1 : -1;

  return data.sort((a, b) => {
    const valueA = getComparableValue(a, key);
    const valueB = getComparableValue(b, key);
    return valueA.localeCompare(valueB) * factor;
  });
});

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'delete', id: string): void;
}>();

function setSort(key: SortKey) {
  if (sortState.value.key === key) {
    sortState.value.direction = sortState.value.direction === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.value.key = key;
    sortState.value.direction = 'asc';
  }
}
</script>

<template>
  <table class="source-table">
    <thead>
      <tr>
        <th>
          <button type="button" class="sort-button" @click="setSort('name')">
            Name
            <span v-if="sortState.key === 'name'" aria-hidden="true">
              {{ sortState.direction === 'asc' ? '▲' : '▼' }}
            </span>
          </button>
        </th>
        <th>
          <button type="button" class="sort-button" @click="setSort('pluginKey')">
            Plugin
            <span v-if="sortState.key === 'pluginKey'" aria-hidden="true">
              {{ sortState.direction === 'asc' ? '▲' : '▼' }}
            </span>
          </button>
        </th>
        <th>Schedule</th>
        <th>
          <button type="button" class="sort-button" @click="setSort('status')">
            Status
            <span v-if="sortState.key === 'status'" aria-hidden="true">
              {{ sortState.direction === 'asc' ? '▲' : '▼' }}
            </span>
          </button>
        </th>
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

.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 600;
  color: #111827;
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
