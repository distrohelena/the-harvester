<script setup lang="ts">
import { computed } from 'vue';
import CronInput from '../forms/CronInput.vue';
import DynamicForm from '../forms/DynamicForm.vue';
import type { PluginDescriptor, SourceModel } from '../../types/plugins';

const props = defineProps<{
  plugins: PluginDescriptor[];
  modelValue: Partial<SourceModel>;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Partial<SourceModel>): void;
}>();

const form = computed(() => props.modelValue ?? {});

function update(value: Partial<SourceModel>) {
  emit('update:modelValue', { ...form.value, ...value });
}

const selectedPlugin = computed(() => props.plugins.find((plugin) => plugin.key === form.value.pluginKey));
const isSubmitting = computed(() => props.submitting ?? false);
</script>

<template>
  <div class="source-form">
    <label>
      Name
      <input type="text" :value="form.name ?? ''" required @input="update({ name: ($event.target as HTMLInputElement).value })" />
    </label>

    <label>
      Plugin
      <select
        required
        :value="form.pluginKey ?? ''"
        @change="update({ pluginKey: ($event.target as HTMLSelectElement).value, options: {} })"
      >
        <option value="" disabled>Select a plugin</option>
        <option v-for="plugin in plugins" :key="plugin.key" :value="plugin.key">
          {{ plugin.name }} ({{ plugin.key }})
        </option>
      </select>
    </label>

    <div class="schedule-group">
      <span class="schedule-label">Schedule (cron)</span>
      <CronInput :model-value="form.scheduleCron" @update:model-value="(value) => update({ scheduleCron: value })" />
    </div>

    <label class="checkbox">
      <input type="checkbox" :checked="form.isActive ?? true" @change="update({ isActive: ($event.target as HTMLInputElement).checked })" />
      Active
    </label>

    <section v-if="selectedPlugin">
      <h3>Plugin Options</h3>
      <DynamicForm
        :schema="selectedPlugin.optionsSchema"
        :model-value="form.options ?? {}"
        :disabled="isSubmitting"
        @update:model-value="(value) => update({ options: value })"
      />
    </section>

    <button type="submit" :disabled="isSubmitting">
      {{ isSubmitting ? 'Saving…' : 'Save Source' }}
    </button>
  </div>
</template>

<style scoped>
.source-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 480px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-weight: 600;
}

.schedule-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.schedule-label {
  font-weight: 600;
}

.checkbox {
  flex-direction: row;
  align-items: center;
  font-weight: 500;
}

input,
select {
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
}

button {
  align-self: flex-start;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1.5rem;
  cursor: pointer;
}
</style>
