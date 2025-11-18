<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { fetchSources } from '../../api/sources';
import { fetchArtifacts } from '../../api/artifacts';
import type { ArtifactModel, SourceModel } from '../../types/plugins';
import DocsTree, { DocsTreeNode } from './DocsTree.vue';

const state = reactive({
  sources: [] as SourceModel[],
  artifacts: [] as ArtifactModel[],
  selectedSourceId: '' as string,
  loadingSources: false,
  loadingArtifacts: false,
  error: '' as string | undefined
});

const searchQuery = ref('');
const selectedArtifactId = ref<string>();
const selectedAnchorSlug = ref<string>();
const contentRef = ref<HTMLElement | null>(null);

const selectedArtifact = computed(() =>
  state.artifacts.find((artifact) => artifact.id === selectedArtifactId.value)
);

const filteredArtifacts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const list = [...state.artifacts];
  const sorter = (a: ArtifactModel, b: ArtifactModel) => a.displayName.localeCompare(b.displayName);
  if (!query) {
    return list.sort(sorter);
  }
  return list
    .filter((artifact) => {
      const space = artifactSpace(artifact).toLowerCase();
      const title = artifact.displayName.toLowerCase();
      const folderPath = artifactFolderPath(artifact).toLowerCase();
      return space.includes(query) || title.includes(query) || folderPath.includes(query);
    })
    .sort(sorter);
});

const treeNodes = computed<DocsTreeNode[]>(() => {
  if (!filteredArtifacts.value.length) {
    return [];
  }

  const roots: DocsTreeNode[] = [];
  const nodeMap = new Map<string, DocsTreeNode>();

  const ensureNode = (id: string, label: string, parent?: DocsTreeNode) => {
    let node = nodeMap.get(id);
    if (!node) {
      node = { id, label, children: [] };
      nodeMap.set(id, node);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return node;
  };

  filteredArtifacts.value.forEach((artifact) => {
    const space = artifactSpace(artifact);
    const spaceId = `space:${space}`;
    const spaceNode = ensureNode(spaceId, space);
    const segments = artifactPathSegments(artifact);
    let parent = spaceNode;
    segments.forEach((segment, index) => {
      const key = `${parent.id}/${segment}`;
      const node = ensureNode(key, segment, parent);
      const isLeaf = index === segments.length - 1;
      if (isLeaf && artifactRenderable(artifact)) {
        node.artifactId = artifact.id;
      }
      parent = node;
    });
  });

  const sortNodes = (nodes?: DocsTreeNode[]) => {
    if (!nodes) return;
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
});

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
    } else {
      state.artifacts = [];
      selectedArtifactId.value = undefined;
    }
  }
);

watch(selectedAnchorSlug, (anchor) => {
  if (anchor) {
    scrollToAnchor(anchor);
  }
});

watch(selectedArtifactId, () => {
  if (!selectedAnchorSlug.value) {
    nextTick(() => {
      contentRef.value?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }
});

async function loadSources() {
  state.loadingSources = true;
  state.error = undefined;
  try {
    const response = await fetchSources({ pluginKey: 'confluence', limit: 100 });
    state.sources = response.items;
    if (!state.selectedSourceId && response.items.length > 0) {
      state.selectedSourceId = response.items[0].id;
    }
  } catch (error: any) {
    state.error = error?.message ?? 'Failed to load Confluence sources';
  } finally {
    state.loadingSources = false;
  }
}

async function loadArtifactsForSource(sourceId: string) {
  state.loadingArtifacts = true;
  state.error = undefined;
  state.artifacts = [];
  selectedArtifactId.value = undefined;
  selectedAnchorSlug.value = undefined;
  searchQuery.value = '';
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
    state.artifacts = collected;
    if (collected.length) {
      selectedArtifactId.value = collected[0].id;
    }
  } catch (error: any) {
    state.error = error?.message ?? 'Failed to load Confluence artifacts';
  } finally {
    state.loadingArtifacts = false;
  }
}

function artifactSpace(artifact: ArtifactModel): string {
  return (
    artifact.lastVersion?.metadata?.spaceName ??
    artifact.lastVersion?.metadata?.spaceKey ??
    (artifact.lastVersion?.data as any)?.spaceKey ??
    'Unassigned Space'
  );
}

function artifactFolderPath(artifact: ArtifactModel): string {
  return (
    artifact.lastVersion?.metadata?.folderPath ??
    artifact.lastVersion?.metadata?.pathSegments?.join(' / ') ??
    ''
  );
}

function artifactPathSegments(artifact: ArtifactModel): string[] {
  const segments = artifact.lastVersion?.metadata?.pathSegments;
  if (Array.isArray(segments) && segments.length) {
    return segments.map((segment: string) => segment?.trim()).filter(Boolean);
  }
  const folderPath = artifactFolderPath(artifact);
  if (folderPath) {
    return folderPath.split('/').map((segment) => segment.trim()).filter(Boolean);
  }
  const display = artifact.displayName?.trim();
  return display ? [display] : [artifact.id];
}

function artifactRenderable(artifact: ArtifactModel): boolean {
  return artifact.lastVersion?.metadata?.isFolder !== true;
}

function selectArtifact(id: string, anchor?: string) {
  const samePage = selectedArtifactId.value === id;
  selectedArtifactId.value = id;
  selectedAnchorSlug.value = anchor;
  if (anchor) {
    scrollToAnchor(anchor);
  } else if (!samePage) {
    nextTick(() => {
      contentRef.value?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }
}

function handleTreeSelect(payload: { artifactId: string; anchor?: string }) {
  if (payload?.artifactId) {
    selectArtifact(payload.artifactId, payload.anchor);
  }
}

function scrollToAnchor(anchor: string) {
  nextTick(() => {
    if (!contentRef.value) return;
    const escaped =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(anchor)
        : anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const target =
      contentRef.value.querySelector<HTMLElement>(`#${escaped}`) ??
      contentRef.value.querySelector<HTMLElement>(`[id="${anchor}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function handleContentClick(event: MouseEvent) {
  const artifact = selectedArtifact.value;
  if (!artifact?.lastVersion?.originalUrl) {
    return;
  }
  const anchor = (event.target as HTMLElement)?.closest<HTMLAnchorElement>('a');
  if (!anchor) {
    return;
  }
  const href = anchor.getAttribute('href');
  if (!href || anchor.target === '_blank') {
    return;
  }
  if (href.startsWith('#')) {
    event.preventDefault();
    const slug = href.slice(1);
    if (slug) {
      selectArtifact(artifact.id, slug);
    }
    return;
  }
  event.preventDefault();
  try {
    const base = new URL(artifact.lastVersion.originalUrl);
    const resolved = new URL(href, base);
    window.open(resolved.toString(), '_blank', 'noopener');
  } catch {
    window.open(artifact.lastVersion.originalUrl, '_blank', 'noopener');
  }
}

function formatTimestamp(value?: string) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
</script>

<template>
  <div class="confluence-browser">
    <div class="sources-panel">
      <header>
        <h3>Confluence Sources</h3>
        <button type="button" class="ghost" @click="loadSources" :disabled="state.loadingSources">
          {{ state.loadingSources ? 'Refreshing…' : 'Refresh' }}
        </button>
      </header>
      <p v-if="state.loadingSources && !state.sources.length" class="placeholder">Loading…</p>
      <ul v-else-if="state.sources.length">
        <li
          v-for="source in state.sources"
          :key="source.id"
          :class="{ active: source.id === state.selectedSourceId }"
          @click="state.selectedSourceId = source.id"
        >
          <p>{{ source.name }}</p>
          <small>{{ source.options?.baseUrl ?? 'Unknown URL' }}</small>
        </li>
      </ul>
      <p v-else class="placeholder">
        No Confluence sources found. Configure a source with the Confluence plugin to get started.
      </p>
    </div>

    <div class="pages-panel">
      <header>
        <div>
          <h3>Pages</h3>
          <small v-if="filteredArtifacts.length">{{ filteredArtifacts.length }} results</small>
        </div>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search by title, space, or folder"
          :disabled="state.loadingArtifacts"
        />
      </header>
      <p v-if="state.loadingArtifacts && !state.artifacts.length" class="placeholder">Loading pages…</p>
      <DocsTree
        v-else-if="treeNodes.length"
        :nodes="treeNodes"
        :selected-artifact-id="selectedArtifactId"
        @select="(payload) => handleTreeSelect(payload)"
      />
      <p v-else class="placeholder">No pages available for this source.</p>
    </div>

    <div class="content-panel">
      <div v-if="state.error" class="error">{{ state.error }}</div>
      <template v-else-if="selectedArtifact">
        <header>
          <div>
            <h2>{{ selectedArtifact.displayName }}</h2>
            <p>
              Space:
              <strong>{{ artifactSpace(selectedArtifact) }}</strong>
              <span v-if="selectedArtifact.lastVersion?.version">
                · Version {{ selectedArtifact.lastVersion.version }}
              </span>
              <span v-if="selectedArtifact.lastVersion?.timestamp">
                · Updated {{ formatTimestamp(selectedArtifact.lastVersion.timestamp) }}
              </span>
            </p>
          </div>
          <a
            v-if="selectedArtifact.lastVersion?.originalUrl"
            :href="selectedArtifact.lastVersion.originalUrl"
            target="_blank"
            rel="noopener"
          >
            Open in Confluence
          </a>
        </header>
        <p class="notice">
          Comments and inline annotations are only visible on the original Confluence page.
        </p>
        <article
          ref="contentRef"
          class="page-content"
          v-html="renderedHtml"
          @click="handleContentClick"
        />
      </template>
      <p v-else class="placeholder">Select a Confluence page to view its content.</p>
    </div>
  </div>
</template>

<style scoped>
.confluence-browser {
  display: grid;
  grid-template-columns: 220px 280px 1fr;
  gap: 1rem;
}

.sources-panel,
.pages-panel,
.content-panel {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #fff;
  padding: 1rem;
  min-height: 400px;
  overflow: hidden;
}

.sources-panel header,
.pages-panel header,
.content-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  gap: 0.5rem;
}

.sources-panel ul,
.pages-panel ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.sources-panel li,
.pages-panel li {
  padding: 0.45rem 0.5rem;
  border-radius: 0.35rem;
  cursor: pointer;
  border: 1px solid transparent;
}

.sources-panel li.active,
.pages-panel li.active {
  background: #dbeafe;
  border-color: #93c5fd;
  font-weight: 600;
}

.sources-panel small,
.pages-panel small {
  color: #6b7280;
}

.pages-panel input[type='search'] {
  flex: 1;
  border: 1px solid #d1d5db;
  border-radius: 0.35rem;
  padding: 0.4rem 0.6rem;
}

.content-panel {
  overflow-y: auto;
}

.content-panel header {
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.75rem;
}

.content-panel header a {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
}

.notice {
  margin: 0 0 0.75rem;
  background: #fef3c7;
  color: #92400e;
  padding: 0.5rem 0.75rem;
  border-radius: 0.35rem;
  font-size: 0.9rem;
}

.page-content :deep(img) {
  max-width: 100%;
}

.page-content :deep(pre) {
  overflow-x: auto;
  background: #0f172a;
  color: #f8fafc;
  padding: 0.75rem;
  border-radius: 0.35rem;
}

.placeholder {
  color: #6b7280;
  font-style: italic;
}

.error {
  color: #b91c1c;
  font-weight: 600;
}

.ghost {
  border: 1px solid #d1d5db;
  background: transparent;
  border-radius: 0.375rem;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
}

.ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
