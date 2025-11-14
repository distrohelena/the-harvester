<script setup lang="ts">
import { computed } from 'vue';
import type { PluginSchema, PluginSchemaField } from '../../types/plugins';

const props = defineProps<{
  schema: PluginSchema;
  modelValue: Record<string, any>;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, any>): void;
}>();

const normalizedModel = computed(() => props.modelValue ?? {});
const isDisabled = computed(() => props.disabled ?? false);

function updateField(field: PluginSchemaField, rawValue: any) {
  let value = rawValue;
  if (field.type === 'number') {
    value = rawValue === '' ? undefined : Number(rawValue);
  }
  if (field.type === 'boolean') {
    value = Boolean(rawValue);
  }
  if (field.type === 'array') {
    if (Array.isArray(rawValue)) {
      value = rawValue;
    } else if (typeof rawValue === 'string') {
      value = rawValue
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  if (field.type === 'object' && typeof rawValue === 'string') {
    try {
      value = JSON.parse(rawValue);
    } catch (err) {
      console.warn('Invalid JSON payload for field', field.name);
    }
  }

  emit('update:modelValue', {
    ...normalizedModel.value,
    [field.name]: value
  });
}

function getValue(field: PluginSchemaField) {
  const value = normalizedModel.value?.[field.name];
  if (field.type === 'array' && Array.isArray(value)) {
    return value.join('\n');
  }
  if (field.type === 'object' && value) {
    return JSON.stringify(value, null, 2);
  }
  return value ?? '';
}
</script>

<template>
  <div class="dynamic-form">
    <div v-for="field in schema.fields" :key="field.name" class="form-field">
      <label :for="field.name">{{ field.label }} <span v-if="field.required">*</span></label>
      <small v-if="field.description">{{ field.description }}</small>
      <template v-if="field.type === 'string' || field.type === 'number'">
        <input
          :id="field.name"
          :type="field.type === 'number' ? 'number' : 'text'"
          :required="field.required"
          :disabled="isDisabled"
          :value="getValue(field)"
          @input="updateField(field, ($event.target as HTMLInputElement).value)"
        />
      </template>
      <template v-else-if="field.type === 'boolean'">
        <input
          :id="field.name"
          type="checkbox"
          :checked="Boolean(normalizedModel[field.name])"
          :disabled="isDisabled"
          @change="updateField(field, ($event.target as HTMLInputElement).checked)"
        />
      </template>
      <template v-else-if="field.type === 'enum'">
        <select
          :id="field.name"
          :disabled="isDisabled"
          :value="getValue(field)"
          @change="updateField(field, ($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>Select value</option>
          <option v-for="option in field.enumValues ?? []" :key="option" :value="option">
            {{ option }}
          </option>
        </select>
      </template>
      <template v-else>
        <textarea
          :id="field.name"
          :rows="field.type === 'array' ? 4 : 6"
          :disabled="isDisabled"
          :placeholder="field.type === 'array' ? 'One value per line' : 'JSON payload'"
          :value="getValue(field)"
          @input="updateField(field, ($event.target as HTMLTextAreaElement).value)"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.dynamic-form {
  display: grid;
  gap: 1rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

input,
select,
textarea {
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
}

label {
  font-weight: 600;
}

small {
  color: #6b7280;
}
</style>
