<script setup lang="ts">
import { ref } from 'vue';
import DocsBrowser from '../components/plugins/DocsBrowser.vue';
import ConfluenceBrowser from '../components/plugins/ConfluenceBrowser.vue';
import GitBrowser from '../components/plugins/GitBrowser.vue';
import JiraBrowser from '../components/plugins/JiraBrowser.vue';

const activeTab = ref<'docs' | 'confluence' | 'git' | 'jira'>('docs');
</script>

<template>
  <div class="plugins-view">
    <div class="tab-bar">
      <button type="button" :class="{ active: activeTab === 'docs' }" @click="activeTab = 'docs'">
        Documentation
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'confluence' }"
        @click="activeTab = 'confluence'"
      >
        Confluence
      </button>
      <button type="button" :class="{ active: activeTab === 'git' }" @click="activeTab = 'git'">
        Git
      </button>
      <button type="button" :class="{ active: activeTab === 'jira' }" @click="activeTab = 'jira'">
        Jira
      </button>
    </div>

    <section class="tab-content">
      <div v-if="activeTab === 'docs'" class="tab-panel">
        <DocsBrowser class="tab-panel__content" />
      </div>
      <div v-else-if="activeTab === 'confluence'" class="tab-panel">
        <ConfluenceBrowser class="tab-panel__content" />
      </div>
      <div v-else-if="activeTab === 'git'" class="tab-panel">
        <GitBrowser class="tab-panel__content" />
      </div>
      <div v-else class="tab-panel">
        <JiraBrowser class="tab-panel__content" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.plugins-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
  min-height: 0;
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
  flex: 1;
  min-height: 0;
  display: flex;
}

.tab-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-panel__content {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
}
</style>
