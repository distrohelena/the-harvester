<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import DocsBrowser from '../components/plugins/DocsBrowser.vue';
import ConfluenceBrowser from '../components/plugins/ConfluenceBrowser.vue';
import GitBrowser from '../components/plugins/GitBrowser.vue';
import JiraBrowser from '../components/plugins/JiraBrowser.vue';

type TabKey = 'docs' | 'confluence' | 'git' | 'jira';
const props = defineProps<{ tab?: string; artifactId?: string }>();
const router = useRouter();

// Drive the plugin tabs from the URL so docs pages can provide deep links like /plugins/docs/:artifactId.
const resolveTab = (value?: string): TabKey => {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'confluence' || normalized === 'git' || normalized === 'jira') {
    return normalized;
  }
  return 'docs';
};

const artifactPath = (tab: TabKey, artifactId?: string) => {
  if (tab !== 'docs') {
    return `/plugins/${tab}`;
  }
  return artifactId ? `/plugins/docs/${artifactId}` : '/plugins/docs';
};

const activeTab = ref<TabKey>(resolveTab(props.tab));
const lastDocsArtifactId = ref<string | undefined>(props.artifactId);

watch(
  () => props.tab,
  (next) => {
    const resolved = resolveTab(typeof next === 'string' ? next : undefined);
    if (activeTab.value !== resolved) {
      activeTab.value = resolved;
    }
    if (next !== resolved) {
      router.replace(artifactPath(resolved, resolved === 'docs' ? props.artifactId : undefined));
    }
  },
  { immediate: true }
);

watch(
  () => props.artifactId,
  (next) => {
    if (next) {
      lastDocsArtifactId.value = next;
    }
  },
  { immediate: true }
);

const docArtifactId = computed(() => (activeTab.value === 'docs' ? props.artifactId : undefined));

function setTab(tab: TabKey) {
  if (tab === activeTab.value) {
    if (tab === 'docs') {
      router.replace(artifactPath('docs', props.artifactId ?? lastDocsArtifactId.value));
    }
    return;
  }
  activeTab.value = tab;
  if (tab === 'docs') {
    router.push(artifactPath('docs', lastDocsArtifactId.value));
  } else {
    router.push(artifactPath(tab));
  }
}

function handleDocsSelection(artifactId?: string) {
  // Keep the docs browser URL shareable by reflecting the current artifact id in the route.
  lastDocsArtifactId.value = artifactId;
  router.replace(artifactPath('docs', artifactId));
}
</script>

<template>
  <div class="plugins-view">
    <div class="tab-bar">
      <button type="button" :class="{ active: activeTab === 'docs' }" @click="setTab('docs')">
        Documentation
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'confluence' }"
        @click="setTab('confluence')"
      >
        Confluence
      </button>
      <button type="button" :class="{ active: activeTab === 'git' }" @click="setTab('git')">
        Git
      </button>
      <button type="button" :class="{ active: activeTab === 'jira' }" @click="setTab('jira')">
        Jira
      </button>
    </div>

    <section class="tab-content">
      <div v-if="activeTab === 'docs'" class="tab-panel">
        <DocsBrowser
          class="tab-panel__content"
          :selected-artifact-id="docArtifactId"
          @update:selected-artifact-id="handleDocsSelection"
        />
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
