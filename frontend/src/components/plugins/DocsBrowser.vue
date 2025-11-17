<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
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
  artifacts: new Map<string, ArtifactModel>(),
  pathIndex: new Map<string, string>()
});

const selectedArtifactId = ref<string>();
const selectedAnchorSlug = ref<string>();
const contentRef = ref<HTMLElement | null>(null);

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
  selectedAnchorSlug.value = undefined;

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
    const { tree, pathIndex } = buildTree(collected);
    state.tree = tree;
    state.pathIndex = pathIndex;
    if (collected.length > 0) {
      selectedArtifactId.value = collected[0].id;
    }
  } catch (error: any) {
    state.error = error?.message ?? 'Failed to load documentation artifacts';
  } finally {
    state.loadingArtifacts = false;
  }
}

function buildTree(artifacts: ArtifactModel[]): { tree: DocsTreeNode[]; pathIndex: Map<string, string> } {
  const versionMap = new Map<string, DocsTreeNode>();
  const pathIndex = new Map<string, string>();

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
    const versionLabel =
      artifact.lastVersion?.metadata?.packageVersion ??
      artifact.lastVersion?.data?.packageVersion ??
      'unknown';
    const path = normalizeDocPath(artifact.lastVersion?.data?.path);
    if (path) {
      pathIndex.set(path, artifact.id);
    }
    const segments = path.split('/').filter(Boolean);
    const versionNode = getVersionNode(versionLabel);
    versionNode.children = versionNode.children ?? [];

    let current = versionNode;

    const walkSegments = segments.length ? segments : ['index'];
    walkSegments.forEach((segment, index) => {
      const isLeaf = index === walkSegments.length - 1;
      if (!current.children) current.children = [];

      if (isLeaf) {
        const leaf: DocsTreeNode = {
          id: artifact.id,
          label: artifact.displayName || segment || artifact.id,
          artifactId: artifact.id
        };

        const headingsRaw = artifact.lastVersion?.data?.headings;
        if (Array.isArray(headingsRaw) && headingsRaw.length) {
          const headingNodes = headingsRaw
            .map((heading: any, idx: number) => {
              const rawText = typeof heading === 'string' ? heading : heading?.text;
              const text = rawText?.replace(/¶/g, '').trim();
              const anchor = typeof heading === 'string' ? undefined : heading?.anchor;
              if (!text || !anchor) return null;
              return {
                id: `${artifact.id}-heading-${idx}`,
                label: text,
                artifactId: artifact.id,
                anchor
              } as DocsTreeNode;
            })
            .filter((node): node is DocsTreeNode => Boolean(node));
          if (headingNodes.length) {
            leaf.children = headingNodes;
          }
        }

        current.children.push(leaf);
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
  return { tree: roots, pathIndex };
}

function normalizeDocPath(path?: string | null): string {
  if (!path) return '/';
  let cleaned = path.trim();
  if (!cleaned.startsWith('/')) {
    cleaned = `/${cleaned}`;
  }
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned || '/';
}

function selectArtifact(id: string, anchor?: string) {
  const isSameArtifact = selectedArtifactId.value === id;
  selectedArtifactId.value = id;
  selectedAnchorSlug.value = anchor ?? undefined;
  if (anchor) {
    scrollToAnchor(anchor);
  } else if (!isSameArtifact) {
    nextTick(() => {
      contentRef.value?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }
}

const renderedHtml = computed(() => {
  const html = selectedArtifact.value?.lastVersion?.data?.html;
  if (!html) return '<p>No content found for this page.</p>';
  return html;
});

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
  if (!artifact?.lastVersion) {
    return;
  }
  const target = (event.target as HTMLElement)?.closest<HTMLAnchorElement>('a');
  if (!target) {
    return;
  }
  const href = target.getAttribute('href');
  if (!href || target.target === '_blank') {
    return;
  }
  if (href.startsWith('#')) {
    event.preventDefault();
    const slug = href.slice(1);
    if (slug) {
      selectedAnchorSlug.value = slug;
      scrollToAnchor(slug);
    }
    return;
  }

  const currentUrl = artifact.lastVersion.originalUrl
    ? new URL(artifact.lastVersion.originalUrl)
    : null;
  if (!currentUrl) {
    return;
  }

  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(href, currentUrl);
  } catch {
    return;
  }

  if (resolvedUrl.origin !== currentUrl.origin) {
    return;
  }

  const normalizedPath = extractRelativePath(resolvedUrl, artifact.lastVersion.metadata?.versionBasePath);
  if (!normalizedPath) {
    return;
  }
  const targetId = state.pathIndex.get(normalizedPath);
  if (!targetId) {
    return;
  }

  event.preventDefault();
  const anchor = resolvedUrl.hash ? resolvedUrl.hash.slice(1) : undefined;
  selectArtifact(targetId, anchor);
}

function extractRelativePath(url: URL, basePath?: string | null): string | null {
  const normalizedBase = !basePath || basePath === '/' ? '/' : basePath.endsWith('/') ? basePath : `${basePath}/`;
  if (normalizedBase === '/') {
    return normalizeDocPath(url.pathname);
  }
  const baseNoTrailing = normalizedBase.slice(0, -1);
  if (url.pathname === baseNoTrailing) {
    return '/';
  }
  if (!url.pathname.startsWith(normalizedBase)) {
    return null;
  }
  const remainder = url.pathname.slice(normalizedBase.length);
  return normalizeDocPath(remainder ? `/${remainder}` : '/');
}

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
        @select="({ artifactId, anchor }) => selectArtifact(artifactId, anchor)"
      />
    </div>

    <div class="content-panel">
      <div v-if="state.error" class="error">{{ state.error }}</div>
      <template v-else-if="selectedArtifact">
        <header>
          <div>
            <h2>{{ selectedArtifact.displayName }}</h2>
            <p>
              Version: {{ selectedArtifact.lastVersion?.version ?? '1' }}
              <span v-if="selectedArtifact.lastVersion?.metadata?.packageVersion">
                · Package {{ selectedArtifact.lastVersion?.metadata?.packageVersion }}
              </span>
              <a
                v-if="selectedArtifact.lastVersion?.originalUrl"
                :href="selectedArtifact.lastVersion.originalUrl"
                target="_blank"
                rel="noopener"
              >
                (Open original)
              </a>
            </p>
          </div>
        </header>
        <article
          ref="contentRef"
          class="doc-content"
          v-html="renderedHtml"
          @click="handleContentClick"
        />
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
  justify-content:inline;
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

.doc-content :deep(h1),
.doc-content :deep(h2),
.doc-content :deep(h3),
.doc-content :deep(h4),
.doc-content :deep(h5),
.doc-content :deep(h6) {
  position: relative;
}

.doc-content :deep(h1 a),
.doc-content :deep(h2 a),
.doc-content :deep(h3 a),
.doc-content :deep(h4 a),
.doc-content :deep(h5 a),
.doc-content :deep(h6 a) {
  opacity: 0;
  color: inherit;
  text-decoration: none;
  margin-left: 0.35rem;
  transition: opacity 0.2s ease;
}

.doc-content :deep(h1:hover a),
.doc-content :deep(h2:hover a),
.doc-content :deep(h3:hover a),
.doc-content :deep(h4:hover a),
.doc-content :deep(h5:hover a),
.doc-content :deep(h6:hover a) {
  opacity: 1;
}

.doc-content :deep(a.header-anchor),
.doc-content :deep(a.anchor),
.doc-content :deep(.hash-link) {
  opacity: 0;
}

.doc-content :deep(h1:hover a.header-anchor),
.doc-content :deep(h2:hover a.header-anchor),
.doc-content :deep(h3:hover a.header-anchor),
.doc-content :deep(h4:hover a.header-anchor),
.doc-content :deep(h5:hover a.header-anchor),
.doc-content :deep(h6:hover a.header-anchor),
.doc-content :deep(h1:hover a.anchor),
.doc-content :deep(h2:hover a.anchor),
.doc-content :deep(h3:hover a.anchor),
.doc-content :deep(h4:hover a.anchor),
.doc-content :deep(h5:hover a.anchor),
.doc-content :deep(h6:hover a.anchor),
.doc-content :deep(h1:hover .hash-link),
.doc-content :deep(h2:hover .hash-link),
.doc-content :deep(h3:hover .hash-link),
.doc-content :deep(h4:hover .hash-link),
.doc-content :deep(h5:hover .hash-link),
.doc-content :deep(h6:hover .hash-link) {
  opacity: 1;
}

.placeholder {
  color: #6b7280;
}

.error {
  color: #b91c1c;
  font-weight: 600;
}
</style>
