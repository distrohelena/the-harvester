<script setup lang="ts">
import { computed } from 'vue';

const CRON_PARTS = [
  { label: 'Minute', placeholder: '0' },
  { label: 'Hour', placeholder: '12' },
  { label: 'Day of month', placeholder: '1' },
  { label: 'Month', placeholder: '1' },
  { label: 'Day of week', placeholder: '1' }
] as const;

const props = defineProps<{
  modelValue?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value?: string): void;
}>();

const parsedParts = computed(() => {
  const raw = props.modelValue?.trim();
  if (!raw) {
    return Array(CRON_PARTS.length).fill('');
  }

  const tokens = raw.split(/\s+/).slice(0, CRON_PARTS.length);
  while (tokens.length < CRON_PARTS.length) {
    tokens.push('*');
  }

  return tokens.map((token) => (token === '*' ? '' : token));
});

function updatePart(index: number, value: string) {
  const next = [...parsedParts.value];
  next[index] = value;

  const hasInput = next.some((part) => part.trim() !== '');
  if (!hasInput) {
    emit('update:modelValue', undefined);
    return;
  }

  const cron = next.map((part) => (part.trim() === '' ? '*' : part.trim())).join(' ');
  emit('update:modelValue', cron);
}
</script>

<template>
  <div class="cron-input">
    <div
      v-for="(part, index) in CRON_PARTS"
      :key="part.label"
      class="cron-field"
    >
      <span class="cron-label">{{ part.label }}</span>
      <input
        type="text"
        :placeholder="part.placeholder"
        :value="parsedParts[index]"
        @input="updatePart(index, ($event.target as HTMLInputElement).value)"
      />
    </div>
    <p class="cron-hint">Leave blank to use “*”. Standard cron order: minute, hour, day of month, month, weekday.</p>
  </div>
</template>

<style scoped>
.cron-input {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.cron-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.cron-label {
  font-size: 0.85rem;
  color: #374151;
}

input {
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.45rem 0.65rem;
}

.cron-hint {
  margin: 0;
  font-size: 0.85rem;
  color: #6b7280;
}
</style>
