<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { fetchSources } from '../../api/sources';
import { fetchArtifacts } from '../../api/artifacts';
import type { ArtifactModel, SourceModel } from '../../types/plugins';
import DocsTree, { DocsTreeNode } from './DocsTree.vue';

const state = reactive({
  sources: [] as SourceModel[],
  selectedSourceId: '' as string,
  loadingSources: false,
  loadingArtifacts: false,
  error: '' as string | undefined,
  tree: [] as DocsTreeNode[],
  artifacts: new Map<string, ArtifactModel>()
});

const selectedArtifactId = ref<string>();

const selectedArtifact = computed(() => {
  if (!selectedArtifactId.value) return undefined;
  return state.artifacts.get(selectedArtifactId.value);
});

async function loadSources() {
  state.loadingSources = true;
  try {
    const response = await fetchSources({ pluginKey: 'docs', limit: 100 });
    state.sources = response.items;
    if (!state.selectedSourceId && state.sources.length > 0) {
      state.selectedSourceId = state.sources[0].id;
    }
  } catch (error: any) {
    state.error = error?.message ?? 'Failed to load documentation sources';
  } finally {
    state.loadingSources = false;
  }
}

async function loadArtifactsForSource(sourceId: string) {
  state.loadingArtifacts = true;
  state.tree = [];
  state.artifacts.clear();
  selectedArtifactId.value = undefined;

  try {
    const perPage = 100;
    let page = 1;
    let total = 0;
    const collected: ArtifactModel[] = [];

    do {
      const response = await fetchArtifacts({ sourceId, limit: perPage, page });
      collected.push(...response.items);
      total = response.total;
      page += 1;
      if (collected.length >= total) {
        break;
      }
    } while (collected.length < total);

    collected.forEach((artifact) => state.artifacts.set(artifact.id, artifact));
    state.tree = buildTree(collected);
    if (collected.length > 0) {
      selectedArtifactId.value = collected[0].id;
    }
  } catch (error: any) {
    state.error = error?.message ?? 'Failed to load documentation artifacts';
  } finally {
    state.loadingArtifacts = false;
  }
}

function buildTree(artifacts: ArtifactModel[]): DocsTreeNode[] {
  const versionMap = new Map<string, DocsTreeNode>();

  const getVersionNode = (versionLabel: string) => {
    if (!versionMap.has(versionLabel)) {
      versionMap.set(versionLabel, {
        id: `version-${versionLabel}`,
        label: versionLabel,
        children: []
      });
    }
    return versionMap.get(versionLabel)!;
  };

  artifacts.forEach((artifact) => {
    const versionLabel = artifact.lastVersion?.data?.version ?? artifact.lastVersion?.version ?? 'latest';
    const path = (artifact.lastVersion?.data?.path ?? '/').trim();
    const segments = path.split('/').filter(Boolean);
    const versionNode = getVersionNode(versionLabel);
    versionNode.children = versionNode.children ?? [];

    let current = versionNode;

    const walkSegments = segments.length ? segments : ['index'];
    walkSegments.forEach((segment, index) => {
      const isLeaf = index === walkSegments.length - 1;
      if (!current.children) current.children = [];

      if (isLeaf) {
        current.children.push({
          id: artifact.id,
          label: artifact.displayName || segment || artifact.id,
          artifactId: artifact.id
        });
        return;
      }

      const nodeKey = `${current.id}-${segment}`;
      let child = current.children.find((childNode) => !childNode.artifactId && childNode.label === segment);
      if (!child) {
        child = { id: nodeKey, label: segment, children: [] };
        current.children.push(child);
      }
      current = child;
    });
  });

  const sortNodes = (nodes?: DocsTreeNode[]) => {
    if (!nodes) return;
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    nodes.forEach((node) => sortNodes(node.children));
  };

  const roots = Array.from(versionMap.values());
  sortNodes(roots);
  return roots;
}

function selectArtifact(id: string) {
  selectedArtifactId.value = id;
}

const renderedHtml = computed(() => {
  const html = selectedArtifact.value?.lastVersion?.data?.html;
  if (!html) return '<p>No content found for this page.</p>';
  return html;
});

onMounted(loadSources);

watch(
  () => state.selectedSourceId,
  (next) => {
    if (next) {
      loadArtifactsForSource(next);
    }
  }
);
</script>

<template>
  <div class="docs-browser">
    <div class="sources-panel">
      <h3>Documentation Sources</h3>
      <div v-if="state.loadingSources">Loading sources…</div>
      <div v-else-if="!state.sources.length">No documentation sources found.</div>
      <ul v-else>
        <li
          v-for="source in state.sources"
          :key="source.id"
          :class="{ active: source.id === state.selectedSourceId }"
          @click="state.selectedSourceId = source.id"
        >
          {{ source.name }}
        </li>
      </ul>
    </div>

    <div class="tree-panel">
      <header>
        <h3>Structure</h3>
        <span v-if="state.loadingArtifacts">Loading pages…</span>
      </header>
      <DocsTree
        :nodes="state.tree"
        :selected-artifact-id="selectedArtifactId"
        @select="selectArtifact"
      />
    </div>

    <div class="content-panel">
      <div v-if="state.error" class="error">{{ state.error }}</div>
      <template v-else-if="selectedArtifact">
        <header>
          <div>
            <h2>{{ selectedArtifact.displayName }}</h2>
            <p>
              Version: {{ selectedArtifact.lastVersion?.data?.version ?? 'latest' }}
              <span v-if="selectedArtifact.lastVersion?.metadata?.packageVersion">
                · Package {{ selectedArtifact.lastVersion?.metadata?.packageVersion }}
              </span>
            </p>
          </div>
        </header>
        <article class="doc-content" v-html="renderedHtml" />
      </template>
      <p v-else class="placeholder">Select a documentation page.</p>
    </div>
  </div>
</template>

<style scoped>
.docs-browser {
  display: grid;
  grid-template-columns: 220px 280px 1fr;
  gap: 1rem;
}

.sources-panel,
.tree-panel,
.content-panel {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #fff;
  padding: 1rem;
  overflow: hidden;
}

.sources-panel ul {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.sources-panel li {
  padding: 0.4rem 0.5rem;
  border-radius: 0.35rem;
  cursor: pointer;
}

.sources-panel li.active {
  background: #dbeafe;
  font-weight: 600;
}

.tree-panel {
  overflow-y: auto;
}

.tree-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.content-panel {
  min-height: 400px;
  overflow-y: auto;
}

.content-panel header {
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
}

.doc-content :deep(img) {
  max-width: 100%;
}

.doc-content :deep(pre) {
  overflow-x: auto;
  background: #0f172a;
  color: #f8fafc;
  padding: 0.75rem;
  border-radius: 0.5rem;
}

.placeholder {
  color: #6b7280;
}

.error {
  color: #b91c1c;
  font-weight: 600;
}
</style>
