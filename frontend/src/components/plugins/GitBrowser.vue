<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import GitCommitViewer from './GitCommitViewer.vue';
import type { ArtifactModel, ArtifactVersionModel, SourceModel } from '../../types/plugins';
import { fetchSources } from '../../api/sources';
import { fetchGitCommits, fetchGitFiles } from '../../api/git';

const sources = ref<SourceModel[]>([]);
const artifacts = ref<ArtifactModel[]>([]);
const fileArtifacts = ref<ArtifactModel[]>([]);
const selectedSourceId = ref<string>();
const selectedArtifactId = ref<string>();
const loadingSources = ref(false);
const loadingArtifacts = ref(false);
const loadingFiles = ref(false);
const pagination = ref({ page: 1, limit: 25, total: 0 });
const viewMode = ref<'files' | 'commits'>('files');
const showCommits = computed(() => viewMode.value === 'commits');

const selectedSource = computed(() => sources.value.find((source) => source.id === selectedSourceId.value));
const commits = computed(() => artifacts.value.filter(isCommitArtifact));
const selectedArtifact = computed(() => commits.value.find((artifact) => artifact.id === selectedArtifactId.value));
const selectedVersion = computed<ArtifactVersionModel | undefined>(() => selectedArtifact.value?.lastVersion);
const hasMoreCommits = ref(false);
const hasMore = computed(() => hasMoreCommits.value);

onMounted(async () => {
  await loadSources();
});

watch(commits, async (next) => {
  if (!next.length) {
    selectedArtifactId.value = undefined;
    fileArtifacts.value = [];
    return;
  }
  const exists = next.some((artifact) => artifact.id === selectedArtifactId.value);
  if (!exists) {
    selectedArtifactId.value = next[0].id;
    await loadFilesForCommit(next[0]);
  }
});

watch(selectedSourceId, async (next) => {
  if (next) {
    viewMode.value = 'files';
    await loadCommits(next);
  } else {
    artifacts.value = [];
    fileArtifacts.value = [];
    selectedArtifactId.value = undefined;
  }
});

async function loadSources() {
  loadingSources.value = true;
  try {
    const response = await fetchSources({ pluginKey: 'git', limit: 100 });
    sources.value = response.items;
    if (!selectedSourceId.value && response.items.length > 0) {
      selectedSourceId.value = response.items[0].id;
    }
  } finally {
    loadingSources.value = false;
  }
}

async function loadCommits(sourceId: string, append = false) {
  loadingArtifacts.value = true;
  try {
    const nextPage = append ? pagination.value.page + 1 : 1;
    const response = await fetchGitCommits(sourceId, nextPage, pagination.value.limit);
    pagination.value = {
      page: response.page,
      limit: response.limit,
      total: response.total
    };
    const nextItems = response.items.filter(isCommitArtifact);
    artifacts.value = append ? [...artifacts.value, ...nextItems] : nextItems;
    hasMoreCommits.value = response.page * response.limit < response.total;
    if (!append) {
      selectedArtifactId.value = artifacts.value[0]?.id;
      await loadFilesForCommit(artifacts.value[0]);
    }
  } finally {
    loadingArtifacts.value = false;
  }
}

async function loadFilesForCommit(artifact?: ArtifactModel) {
  if (!artifact?.lastVersion || !selectedSourceId.value) {
    fileArtifacts.value = [];
    return;
  }
  const commitHash =
    (artifact.lastVersion.data as any)?.commitHash ?? artifact.lastVersion.version ?? artifact.displayName;
  if (!commitHash) {
    fileArtifacts.value = [];
    return;
  }
  loadingFiles.value = true;
  try {
    const response = await fetchGitFiles(selectedSourceId.value, commitHash, 2000);
    fileArtifacts.value = response.items;
  } finally {
    loadingFiles.value = false;
  }
}

function refreshArtifacts() {
  if (selectedSourceId.value) {
    loadCommits(selectedSourceId.value);
  }
}

function loadMore() {
  if (selectedSourceId.value && hasMoreCommits.value && !loadingArtifacts.value) {
    loadCommits(selectedSourceId.value, true);
  }
}

async function selectArtifact(id: string) {
  selectedArtifactId.value = id;
  const artifact = commits.value.find((item) => item.id === id);
  await loadFilesForCommit(artifact);
  viewMode.value = 'files';
}

function toggleCommits() {
  viewMode.value = viewMode.value === 'commits' ? 'files' : 'commits';
}

function formatDate(value?: string) {
  if (!value) {
    return 'Unknown';
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function isCommitArtifact(artifact: ArtifactModel): boolean {
  const dataType = (artifact.lastVersion?.data as any)?.artifactType;
  const metadataType = artifact.lastVersion?.metadata?.artifactType;
  if (metadataType === 'file' || dataType === 'file') {
    return false;
  }
  if (metadataType === 'commit' || dataType === 'commit') {
    return true;
  }
  // Fallback for legacy commit records (before artifactType metadata existed)
  return true;
}

function commitMessage(artifact?: ArtifactModel) {
  const version = artifact?.lastVersion;
  const message: string | undefined = (version?.data as any)?.message ?? version?.data?.displayName;
  return message?.split('\n')[0] ?? artifact?.displayName ?? 'Untitled commit';
}

function commitAuthor(artifact?: ArtifactModel) {
  const version = artifact?.lastVersion;
  return (version?.data as any)?.author ?? version?.metadata?.author ?? 'Unknown';
}

function shortHash(artifact?: ArtifactModel) {
  const version = artifact?.lastVersion;
  const hash: string | undefined = (version?.data as any)?.commitHash ?? version?.version;
  return hash ? hash.slice(0, 7) : '—';
}

function commitBranches(artifact?: ArtifactModel): string[] {
  const version = artifact?.lastVersion;
  const branches: unknown = (version?.data as any)?.branches;
  return Array.isArray(branches) ? branches : [];
}
</script>

<template>
  <div class="git-browser">
    <aside>
      <header>
        <h3>Git Sources</h3>
        <button type="button" class="ghost" @click="loadSources" :disabled="loadingSources">
          {{ loadingSources ? 'Refreshing…' : 'Refresh' }}
        </button>
      </header>
      <div v-if="loadingSources && !sources.length" class="placeholder">Loading sources…</div>
      <ul v-else>
        <li
          v-for="source in sources"
          :key="source.id"
          :class="{ active: source.id === selectedSourceId }"
          @click="selectedSourceId = source.id"
        >
          <p>{{ source.name }}</p>
          <small>{{ source.options?.repoUrl ?? 'Unknown repo' }}</small>
        </li>
      </ul>
      <p v-if="!sources.length && !loadingSources" class="placeholder">
        No Git sources found. Create a source using the Git plugin to get started.
      </p>
    </aside>

    <section class="content">
      <header>
        <div>
          <h3>{{ selectedSource?.name ?? 'Select a Git source' }}</h3>
          <p v-if="selectedSource?.options?.repoUrl">{{ selectedSource.options.repoUrl }}</p>
        </div>
        <button
          v-if="selectedSource"
          type="button"
          class="primary"
          @click="refreshArtifacts"
          :disabled="loadingArtifacts"
        >
          {{ loadingArtifacts ? 'Loading…' : 'Refresh commits' }}
        </button>
      </header>

      <div v-if="selectedSource" class="workspace-wrapper">
        <div class="view-tabs">
          <button type="button" :class="{ active: showCommits }" @click="toggleCommits">
            {{ showCommits ? 'Hide Commits' : 'View Commits' }}
          </button>
        </div>

        <div class="workspace">
          <div class="commit-panel" :class="{ visible: showCommits }">
            <div class="commit-list">
              <div v-if="loadingArtifacts && !commits.length" class="placeholder">Loading commits…</div>
              <div v-else-if="!commits.length" class="placeholder">No commits found for this source.</div>
              <ul v-else>
                <li
                  v-for="artifact in commits"
                  :key="artifact.id"
                  :class="{ active: artifact.id === selectedArtifactId }"
                  @click="selectArtifact(artifact.id)"
                >
                  <div class="details">
                    <p class="message">{{ commitMessage(artifact) }}</p>
                    <p class="meta">
                      {{ commitAuthor(artifact) }} · {{ formatDate(artifact.lastVersion?.createdAt) }}
                    </p>
                    <div class="branches">
                      <span v-for="branch in commitBranches(artifact)" :key="branch">{{ branch }}</span>
                    </div>
                  </div>
                  <span class="hash">{{ shortHash(artifact) }}</span>
                </li>
              </ul>
              <div v-if="hasMore" class="load-more">
                <button type="button" class="ghost" @click="loadMore" :disabled="loadingArtifacts">
                  {{ loadingArtifacts ? 'Loading…' : 'Load more' }}
                </button>
              </div>
            </div>

            <div class="commit-detail">
              <GitCommitViewer
                v-if="selectedArtifact && selectedVersion"
                :artifact="selectedArtifact"
                :version="selectedVersion"
                :files="fileArtifacts"
                :files-loading="loadingFiles"
              />
              <p v-else class="placeholder">Select a commit to inspect its details.</p>
            </div>
          </div>

          <div class="file-panel">
            <div class="file-view">
              <div class="file-view-header" v-if="selectedArtifact">
                <h4>{{ commitMessage(selectedArtifact) }}</h4>
                <p class="meta">
                  {{ shortHash(selectedArtifact) }} · {{ commitAuthor(selectedArtifact) }} ·
                  {{ formatDate(selectedArtifact.lastVersion?.createdAt) }}
                </p>
              </div>
              <GitCommitViewer
                v-if="selectedArtifact && selectedVersion"
                :artifact="selectedArtifact"
                :version="selectedVersion"
                :files="fileArtifacts"
                :files-loading="loadingFiles"
                :show-changes="false"
              />
              <p v-else-if="loadingArtifacts" class="placeholder">Loading repository files…</p>
              <p v-else class="placeholder">No commits available for this source.</p>
            </div>
          </div>
        </div>
      </div>

      <p v-else class="placeholder">Select a Git source from the left to browse commits.</p>
    </section>
  </div>
</template>

<style scoped>
.git-browser {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1rem;
}

aside {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

aside ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

aside li {
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
}

aside li.active {
  border-color: #2563eb;
  background: #eef2ff;
}

aside small {
  color: #475569;
}

.content {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.content > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.workspace-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.workspace {
  display: flex;
  gap: 1rem;
  min-height: 400px;
  align-items: flex-start;
}

.commit-panel {
  flex: 0 0 0;
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: max-width 0.3s ease, flex-basis 0.3s ease, opacity 0.2s ease;
}

.commit-panel.visible {
  flex: 0 0 320px;
  max-width: 320px;
  opacity: 1;
}

.file-panel {
  flex: 1 1 auto;
  transition: flex-basis 0.3s ease;
}

.view-tabs {
  display: inline-flex;
  gap: 0.5rem;
}

.view-tabs button {
  border: 1px solid #cbd5f5;
  border-radius: 999px;
  background: #fff;
  padding: 0.35rem 1rem;
  cursor: pointer;
}

.view-tabs button.active {
  background: #1d4ed8;
  color: #fff;
  border-color: #1d4ed8;
}

.commit-list {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  background: #f8fafc;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.commit-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.commit-list li {
  border: 1px solid transparent;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #fff;
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  cursor: pointer;
}

.commit-list li.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.15);
}

.details .message {
  font-weight: 600;
  margin-bottom: 0.2rem;
}

.details .meta {
  font-size: 0.85rem;
  color: #475569;
}

.branches span {
  display: inline-block;
  background: #e0f2fe;
  color: #0369a1;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 0.75rem;
  margin-right: 0.25rem;
}

.hash {
  font-family: 'Fira Code', monospace;
  color: #334155;
}

.load-more {
  text-align: center;
  margin-top: 0.5rem;
}

.commit-detail {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #fff;
  min-height: 400px;
}

.file-view {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #fff;
}

.file-view-header {
  margin-bottom: 0.75rem;
}

.file-view-header h4 {
  margin: 0;
}

.file-view-header .meta {
  font-size: 0.9rem;
  color: #475569;
}

.placeholder {
  color: #64748b;
}

button.primary {
  border: none;
  background: #2563eb;
  color: #fff;
  border-radius: 0.5rem;
  padding: 0.4rem 1rem;
  cursor: pointer;
}

button.ghost {
  border: 1px solid #cbd5f5;
  background: #fff;
  border-radius: 0.5rem;
  padding: 0.3rem 0.9rem;
  color: #1d4ed8;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
