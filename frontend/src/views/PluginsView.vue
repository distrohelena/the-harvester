<script setup lang="ts">
import { ref } from 'vue';
import DocsBrowser from '../components/plugins/DocsBrowser.vue';

const activeTab = ref<'docs'>('docs');
</script>

<template>
  <div class="plugins-view">
    <div class="tab-bar">
      <button
        type="button"
        :class="{ active: activeTab === 'docs' }"
        @click="activeTab = 'docs'"
      >
        Documentation
      </button>
    </div>

    <section class="tab-content">
      <DocsBrowser v-if="activeTab === 'docs'" />
    </section>
  </div>
</template>

<style scoped>
.plugins-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.tab-bar {
  display: flex;
  gap: 0.5rem;
}

.tab-bar button {
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.35rem 1rem;
  background: #f9fafb;
  cursor: pointer;
}

.tab-bar button.active {
  background: #1d4ed8;
  color: #fff;
  border-color: #1d4ed8;
}

.tab-content {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem;
  background: #fff;
}
</style>
