<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { fetchSources } from '../../api/sources';
import { fetchArtifacts, fetchArtifact } from '../../api/artifacts';
import type { ArtifactModel, SourceModel } from '../../types/plugins';
import DocsTree, { DocsTreeNode } from './DocsTree.vue';

const props = defineProps<{ selectedArtifactId?: string }>();
const emit = defineEmits<{ (e: 'update:selectedArtifactId', artifactId?: string): void }>();

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
// Track the scrollable content panel so selecting a new doc can reset scroll position reliably and evaluate links after render.
const contentRef = ref<HTMLElement | null>(null);
const pendingArtifactId = ref<string | null>(null);
let sourceLoadPromise: Promise<void> | null = null;

const RESPONSIVE_MEDIA_SELECTORS = ['iframe', 'video', 'object', 'embed'];
const RESPONSIVE_MEDIA_QUERY = RESPONSIVE_MEDIA_SELECTORS.join(', ');
const VIDEO_CONTAINER_SELECTORS = [
  'div[data-component-name*="Video"]',
  'div[data-component-name*="video"]',
  'div[data-component-name*="Player"]',
  'div[data-component-name*="player"]',
  'div[class*="video-player"]',
  'div[class*="VideoPlayer"]',
  'div[class*="youtube-player"]',
  'div[class*="YoutubePlayer"]',
  'div[data-video-id]',
  'div[data-youtube-id]'
];
const VIDEO_CONTAINER_QUERY = VIDEO_CONTAINER_SELECTORS.join(', ');

const selectedArtifact = computed(() => {
  if (!selectedArtifactId.value) return undefined;
  return state.artifacts.get(selectedArtifactId.value);
});

const selectedArtifactTitle = computed(() => {
  const artifact = selectedArtifact.value;
  if (!artifact) {
    return '';
  }
  const explicitTitle = artifact.lastVersion?.data?.title?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const displayName = artifact.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return artifact.lastVersion?.data?.path ?? artifact.id;
});

const tableOfContents = computed(() => {
  const headings = selectedArtifact.value?.lastVersion?.data?.headings;
  if (!Array.isArray(headings)) {
    return [];
  }
  return headings
    .map((heading: any) => {
      const text = (typeof heading === 'string' ? heading : heading?.text)?.replace(/¶/g, '').trim();
      const anchor = typeof heading === 'string' ? undefined : heading?.anchor;
      if (!text || !anchor) {
        return null;
      }
      return { text, anchor };
    })
    .filter((entry): entry is { text: string; anchor: string } => Boolean(entry));
});

async function loadSources() {
  state.loadingSources = true;
  try {
    const response = await fetchSources({ pluginKey: 'docs', limit: 100 });
    const existing = [...state.sources];
    const merged = new Map<string, SourceModel>();
    response.items.forEach((source) => merged.set(source.id, source));
    existing.forEach((source) => {
      if (!merged.has(source.id)) {
        merged.set(source.id, source);
      }
    });
    state.sources = Array.from(merged.values());
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
  const previousSelection = selectedArtifactId.value;
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
    if (pendingArtifactId.value && state.artifacts.has(pendingArtifactId.value)) {
      selectedArtifactId.value = pendingArtifactId.value;
      pendingArtifactId.value = null;
    } else if (previousSelection && state.artifacts.has(previousSelection)) {
      selectedArtifactId.value = previousSelection;
    } else if (collected.length > 0) {
      selectedArtifactId.value = collected[0].id;
    } else {
      selectedArtifactId.value = undefined;
    }
  } catch (error: any) {
    state.error = error?.message ?? 'Failed to load documentation artifacts';
  } finally {
    state.loadingArtifacts = false;
  }
}

const queueSourceLoad = (sourceId: string) => {
  const promise = loadArtifactsForSource(sourceId);
  sourceLoadPromise = promise;
  promise.finally(() => {
    if (sourceLoadPromise === promise) {
      sourceLoadPromise = null;
    }
  });
  return promise;
};

const awaitSourceLoad = async () => {
  if (sourceLoadPromise) {
    await sourceLoadPromise;
  }
};

// Allow direct navigation to /plugins/docs/:artifactId by fetching the artifact + selecting the owning source on demand.
async function ensureArtifactSelection(artifactId: string) {
  if (!artifactId) {
    return;
  }
  if (state.artifacts.has(artifactId)) {
    selectedArtifactId.value = artifactId;
    pendingArtifactId.value = null;
    return;
  }
  try {
    const artifact = await fetchArtifact(artifactId);
    const sourceId = artifact.source?.id;
    if (!sourceId) {
      return;
    }
    if (!state.sources.find((source) => source.id === sourceId)) {
      state.sources.push(artifact.source);
    }
    if (state.selectedSourceId !== sourceId) {
      state.selectedSourceId = sourceId;
      await nextTick();
      await awaitSourceLoad();
    } else {
      await queueSourceLoad(sourceId);
    }
    if (state.artifacts.has(artifactId)) {
      selectedArtifactId.value = artifactId;
      pendingArtifactId.value = null;
    }
  } catch (error: any) {
    state.error = error?.message ?? 'Failed to load documentation page';
    pendingArtifactId.value = null;
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
    const lastSegment = segments.length ? segments[segments.length - 1] : 'index';
    const leafLabel =
      artifact.lastVersion?.data?.title ||
      artifact.displayName ||
      lastSegment ||
      artifact.id;
    const versionNode = getVersionNode(versionLabel);
    versionNode.children = versionNode.children ?? [];

    let current = versionNode;

    const walkSegments = segments.length ? segments : ['index'];
    walkSegments.forEach((segment, index) => {
      if (!current.children) current.children = [];

      const nodeKey = `${current.id}-${segment}`;
      let child = current.children.find((childNode) => childNode.id === nodeKey);
      if (!child) {
        child = { id: nodeKey, label: segment, children: [] };
        current.children.push(child);
      }
      const isLeaf = index === walkSegments.length - 1;
      if (isLeaf) {
        child.label = leafLabel;
        child.artifactId = artifact.id;
        child.children = child.children ?? [];
        return;
      }
      current = child;
    });
  });

  const roots = Array.from(versionMap.values());
  if (roots.length === 1 && roots[0].label.toLowerCase() === 'unknown') {
    const onlyRoot = roots[0];
    if (onlyRoot.children?.length) {
      onlyRoot.children.forEach((child) => {
        if (!child.artifactId) {
          child.label = child.label.replace(/^\//, '');
        }
      });
      return { tree: onlyRoot.children, pathIndex };
    }
  }
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

function handleTocClick(anchor: string) {
  if (!anchor) return;
  selectedAnchorSlug.value = anchor;
  scrollToAnchor(anchor);
}

const renderedHtml = computed(() => {
  const html = selectedArtifact.value?.lastVersion?.data?.html;
  if (!html) return '<p>No content found for this page.</p>';
  return html;
});

function scheduleEmbeddedMediaNormalization() {
  nextTick(() => {
    normalizeEmbeddedMedia();
    disableUnharvestedLinks();
  });
}

function normalizeEmbeddedMedia(): void {
  const container = contentRef.value;
  if (!container) return;

  container.querySelectorAll<HTMLImageElement>('img, picture img').forEach((img) => {
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    if (!img.style.display) {
      img.style.display = 'block';
    }
    if (!img.getAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }
  });

  container.querySelectorAll<HTMLElement>(RESPONSIVE_MEDIA_QUERY).forEach((element) => {
    wrapResponsiveElement(element);
  });

  if (VIDEO_CONTAINER_QUERY.length) {
  container.querySelectorAll<HTMLElement>(VIDEO_CONTAINER_QUERY).forEach((element) => {
      if (element.classList.contains('doc-embed-wrapper')) {
        return;
      }
      if (element.querySelector(RESPONSIVE_MEDIA_QUERY)) {
        return;
      }
      wrapResponsiveElement(element);
    });
  }
}

function wrapResponsiveElement(element: HTMLElement): void {
  const parent = element.parentElement;
  if (!parent) return;

  const ratio = deriveAspectRatio(element);
  const existingWrapper = element.closest<HTMLElement>('.doc-embed-wrapper');

  if (existingWrapper) {
    existingWrapper.style.aspectRatio = ratio;
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'doc-embed-wrapper';
    wrapper.style.aspectRatio = ratio;
    wrapper.style.width = '100%';
    parent.insertBefore(wrapper, element);
    wrapper.appendChild(element);
  }

  element.classList.add('doc-embed-child');
  element.style.width = '100%';
  element.style.height = '100%';
  if (element instanceof HTMLIFrameElement || element instanceof HTMLVideoElement) {
    element.style.border = '0';
  }
}

function deriveAspectRatio(element: HTMLElement): string {
  const ratioCandidates = [
    element.getAttribute('data-aspect-ratio'),
    element.getAttribute('data-ratio'),
    element.getAttribute('aspect-ratio'),
    element.style?.aspectRatio,
    typeof window !== 'undefined' ? window.getComputedStyle(element).aspectRatio : undefined
  ];

  for (const candidate of ratioCandidates) {
    const normalized = normalizeRatioCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const widthAttr = parseDimensionAttribute(element.getAttribute('width'));
  const heightAttr = parseDimensionAttribute(element.getAttribute('height'));
  if (widthAttr && heightAttr) {
    return `${widthAttr} / ${heightAttr}`;
  }

  if (element instanceof HTMLVideoElement) {
    const videoWidth = element.videoWidth;
    const videoHeight = element.videoHeight;
    if (videoWidth > 0 && videoHeight > 0) {
      return `${videoWidth} / ${videoHeight}`;
    }
  }

  return '16 / 9';
}

function normalizeRatioCandidate(candidate?: string | null): string | undefined {
  if (!candidate) {
    return undefined;
  }
  const replaced = candidate.replace(/:/g, '/').replace(/\s+/g, ' ').trim();
  if (!replaced || replaced.toLowerCase() === 'auto') {
    return undefined;
  }
  const slashMatch = replaced.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (slashMatch) {
    const width = parseFloat(slashMatch[1]);
    const height = parseFloat(slashMatch[2]);
    if (width > 0 && height > 0) {
      return `${width} / ${height}`;
    }
  }
  const numeric = Number(replaced);
  if (Number.isFinite(numeric) && numeric > 0) {
    return `${numeric}`;
  }
  return undefined;
}

function parseDimensionAttribute(value?: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === 'auto' || trimmed.includes('%')) {
    return undefined;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return undefined;
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

function disableUnharvestedLinks(): void {
  const artifact = selectedArtifact.value;
  const container = contentRef.value;
  if (!artifact || !container) {
    return;
  }
  const root = container.querySelector<HTMLElement>('.doc-content');
  if (!root) {
    return;
  }
  const baseUrl = artifact.lastVersion?.originalUrl ? safeParseUrl(artifact.lastVersion.originalUrl) : null;
  if (!baseUrl) {
    return;
  }
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    anchor.removeAttribute('data-doc-disabled');
    anchor.removeAttribute('aria-disabled');
    anchor.classList.remove('doc-link--disabled');

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || anchor.target === '_blank') {
      return;
    }

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }

    if (resolved.origin !== baseUrl.origin) {
      return;
    }

    const normalized = extractRelativePath(resolved, artifact.lastVersion?.metadata?.versionBasePath);
    if (!normalized || !state.pathIndex.get(normalized)) {
      disableAnchor(anchor);
    }
  });
}

const disableAnchor = (anchor: HTMLAnchorElement) => {
  anchor.setAttribute('data-doc-disabled', 'true');
  anchor.setAttribute('aria-disabled', 'true');
  anchor.classList.add('doc-link--disabled');
};

function handleContentClick(event: MouseEvent) {
  const artifact = selectedArtifact.value;
  if (!artifact?.lastVersion) {
    return;
  }
  const target = (event.target as HTMLElement)?.closest<HTMLAnchorElement>('a');
  if (!target) {
    return;
  }
  const disabledAnchor = target.closest<HTMLAnchorElement>('a[data-doc-disabled="true"]');
  if (disabledAnchor) {
    event.preventDefault();
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

const safeParseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

watch(selectedAnchorSlug, (anchor) => {
  if (anchor) {
    scrollToAnchor(anchor);
  }
});

watch(
  () => props.selectedArtifactId,
  (next) => {
    if (!next) {
      pendingArtifactId.value = null;
      return;
    }
    if (next === selectedArtifactId.value) {
      return;
    }
    pendingArtifactId.value = next;
    ensureArtifactSelection(next);
  },
  { immediate: true }
);

watch(selectedArtifactId, (next) => {
  if (!selectedAnchorSlug.value) {
    nextTick(() => {
      contentRef.value?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }
  scheduleEmbeddedMediaNormalization();
  if (next !== props.selectedArtifactId) {
    emit('update:selectedArtifactId', next);
  }
});

watch(renderedHtml, () => {
  scheduleEmbeddedMediaNormalization();
});

onMounted(() => {
  loadSources();
  scheduleEmbeddedMediaNormalization();
});

watch(
  () => state.selectedSourceId,
  (next) => {
    if (next) {
      queueSourceLoad(next);
    }
  }
);
</script>

<template>
  <div class="docs-browser">
    <div class="sources-panel">
      <header>
        <h3>Sources</h3>
        <button type="button" class="ghost" @click="loadSources" :disabled="state.loadingSources">
          {{ state.loadingSources ? 'Refreshing…' : 'Refresh' }}
        </button>
      </header>
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

    <div class="content-panel" ref="contentRef">
      <div v-if="state.error" class="error">{{ state.error }}</div>
      <template v-else-if="selectedArtifact">
        <header>
          <div>
            <h2>{{ selectedArtifactTitle }}</h2>
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
        <div v-if="tableOfContents.length" class="toc-panel">
          <p class="toc-title">On this page</p>
          <ul>
            <li v-for="heading in tableOfContents" :key="heading.anchor">
              <button type="button" @click="handleTocClick(heading.anchor)">
                {{ heading.text }}
              </button>
            </li>
          </ul>
        </div>
        <article class="doc-content" v-html="renderedHtml" @click="handleContentClick" />
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

.sources-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
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

.toc-panel {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: #f8fafc;
  margin-bottom: 1rem;
}

.toc-title {
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #64748b;
  margin: 0 0 0.5rem;
}

.toc-panel ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.toc-panel button {
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  padding: 0.2rem 0.25rem;
  border-radius: 0.35rem;
  font-size: 0.9rem;
  color: #1d4ed8;
  cursor: pointer;
}

.toc-panel button:hover {
  background: rgba(37, 99, 235, 0.08);
}

.doc-content :deep(img),
.doc-content :deep(picture img) {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Visually flag unharvested links so users do not attempt navigation that the crawler cannot satisfy. */
.doc-content :deep(a.doc-link--disabled) {
  color: #9ca3af;
  pointer-events: none;
  cursor: not-allowed;
  text-decoration: none;
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

.doc-content :deep(.doc-embed-wrapper) {
  width: 100%;
  max-width: 100%;
  display: block;
  overflow: hidden;
  border-radius: 0.75rem;
  background: #0f172a;
  margin: 1.25rem 0;
}

.doc-content :deep(.doc-embed-wrapper .doc-embed-child),
.doc-content :deep(.doc-embed-wrapper iframe),
.doc-content :deep(.doc-embed-wrapper video),
.doc-content :deep(.doc-embed-wrapper embed),
.doc-content :deep(.doc-embed-wrapper object) {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.placeholder {
  color: #6b7280;
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
