<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import GitCommitViewer from './GitCommitViewer.vue';
import type { ArtifactModel, ArtifactVersionModel, SourceModel } from '../../types/plugins';
import { fetchSources } from '../../api/sources';
import {
  fetchGitCommits,
  fetchGitFiles,
  fetchGitCommitSnapshot,
  fetchGitCommitSnapshotFile,
  type GitSnapshotEntry,
  type GitSnapshotFileResponse
} from '../../api/git';

type FileArtifactPayload = {
  artifactId: string;
  path: string;
  commitHash: string;
  blobSha?: string;
  mode?: string;
  size?: number;
  encoding: 'utf8' | 'base64';
  content: string;
};

const sources = ref<SourceModel[]>([]);
const artifacts = ref<ArtifactModel[]>([]);
const fileArtifacts = ref<ArtifactModel[]>([]);
const snapshotFiles = ref<GitSnapshotEntry[]>([]);
const selectedSourceId = ref<string>();
const selectedArtifactId = ref<string>();
const loadingSources = ref(false);
const loadingArtifacts = ref(false);
const loadingFiles = ref(false);
const loadingSnapshot = ref(false);
const pagination = ref({ page: 1, limit: 25, total: 0 });
const viewMode = ref<'files' | 'commits'>('files');
const showCommits = computed(() => viewMode.value === 'commits');
const branchFilter = ref<string | null>(null);
const branchMenuOpen = ref(false);

const selectedSource = computed(() => sources.value.find((source) => source.id === selectedSourceId.value));
const allCommits = computed(() => artifacts.value.filter(isCommitArtifact));
const availableBranches = computed(() => {
  const uniqueBranches = new Set<string>();
  for (const artifact of allCommits.value) {
    for (const branch of commitBranches(artifact)) {
      const trimmed = branch.trim();
      if (trimmed) {
        uniqueBranches.add(trimmed);
      }
    }
  }
  return Array.from(uniqueBranches).sort((a, b) => a.localeCompare(b));
});
const filteredCommits = computed(() => {
  if (!branchFilter.value) {
    return allCommits.value;
  }
  return allCommits.value.filter((artifact) => commitBranches(artifact).includes(branchFilter.value as string));
});
const branchButtonLabel = computed(() => {
  if (branchFilter.value) {
    return `Branch: ${branchFilter.value}`;
  }
  if (availableBranches.value.length === 0) {
    return 'No branches';
  }
  return 'Select Branch';
});
const selectedArtifact = computed(() =>
  filteredCommits.value.find((artifact) => artifact.id === selectedArtifactId.value)
);
const selectedVersion = computed<ArtifactVersionModel | undefined>(() => selectedArtifact.value?.lastVersion);
const hasMoreCommits = ref(false);
const hasMore = computed(() => hasMoreCommits.value);
const snapshotCommitHash = ref<string>();

onMounted(async () => {
  await loadSources();
});

watch(availableBranches, (branches) => {
  if (!branches.length) {
    branchFilter.value = null;
    return;
  }
  if (!branchFilter.value || !branches.includes(branchFilter.value)) {
    branchFilter.value = branches[0];
  }
});

watch(filteredCommits, async (next) => {
  if (!next.length) {
    selectedArtifactId.value = undefined;
    fileArtifacts.value = [];
    snapshotFiles.value = [];
    return;
  }
  const exists = next.some((artifact) => artifact.id === selectedArtifactId.value);
  if (!exists) {
    selectedArtifactId.value = next[0].id;
    await Promise.all([loadFilesForCommit(next[0]), loadSnapshotForCommit(next[0])]);
  }
});

watch(selectedSourceId, async (next) => {
  if (next) {
    viewMode.value = 'files';
    branchFilter.value = null;
    branchMenuOpen.value = false;
    await loadCommits(next);
  } else {
    artifacts.value = [];
    fileArtifacts.value = [];
    snapshotFiles.value = [];
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
      const nextCommit = filteredCommits.value[0];
      selectedArtifactId.value = nextCommit?.id;
      await Promise.all([loadFilesForCommit(nextCommit), loadSnapshotForCommit(nextCommit)]);
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

async function loadSnapshotForCommit(artifact?: ArtifactModel) {
  if (!artifact?.lastVersion || !selectedSourceId.value) {
    snapshotFiles.value = [];
    snapshotCommitHash.value = undefined;
    return;
  }
  const commitHash =
    (artifact.lastVersion.data as any)?.commitHash ?? artifact.lastVersion.version ?? artifact.displayName;
  if (!commitHash) {
    snapshotFiles.value = [];
    snapshotCommitHash.value = undefined;
    return;
  }
  snapshotCommitHash.value = commitHash;
  loadingSnapshot.value = true;
  try {
    const response = await fetchGitCommitSnapshot(selectedSourceId.value, commitHash);
    snapshotFiles.value = response.items;
  } finally {
    loadingSnapshot.value = false;
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
  const artifact = filteredCommits.value.find((item) => item.id === id);
  await Promise.all([loadFilesForCommit(artifact), loadSnapshotForCommit(artifact)]);
  viewMode.value = 'files';
}

async function loadSnapshotFileContent(path: string): Promise<FileArtifactPayload | null> {
  if (!selectedSourceId.value || !snapshotCommitHash.value) {
    return null;
  }
  const response = await fetchGitCommitSnapshotFile(
    selectedSourceId.value,
    snapshotCommitHash.value,
    path
  );
  return {
    artifactId: `${snapshotCommitHash.value}:${path}`,
    path: response.path,
    commitHash: snapshotCommitHash.value,
    blobSha: response.blobSha,
    mode: response.mode,
    size: response.size,
    encoding: response.encoding,
    content: response.content
  };
}

function toggleCommits() {
  viewMode.value = viewMode.value === 'commits' ? 'files' : 'commits';
}

function toggleBranchMenu() {
  branchMenuOpen.value = !branchMenuOpen.value;
}

function selectBranchFilter(branch: string) {
  branchFilter.value = branch;
  branchMenuOpen.value = false;
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

function commitTimestamp(artifact?: ArtifactModel) {
  const version = artifact?.lastVersion;
  return (
    version?.timestamp ??
    (version?.data as any)?.committerDate ??
    (version?.data as any)?.authorDate ??
    version?.createdAt
  );
}

function shortHash(artifact?: ArtifactModel) {
  const version = artifact?.lastVersion;
  const hash: string | undefined = (version?.data as any)?.commitHash ?? version?.version;
  return hash ? hash.slice(0, 7) : '—';
}

function commitBranches(artifact?: ArtifactModel): string[] {
  const version = artifact?.lastVersion;
  const branches: unknown = (version?.data as any)?.branches;
  if (!Array.isArray(branches)) {
    return [];
  }
  return branches
    .filter((branch): branch is string => typeof branch === 'string')
    .map((branch) => branch.trim())
    .filter(Boolean);
}

function commitBranchesForDisplay(artifact?: ArtifactModel): string[] {
  const branches = commitBranches(artifact);
  if (branchFilter.value) {
    return branches.filter((branch) => branch === branchFilter.value);
  }
  return branches;
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
      <div class="source-scroll">
        <div v-if="loadingSources && !sources.length" class="placeholder">Loading sources…</div>
        <ul v-else-if="sources.length">
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
        <p v-else class="placeholder">
          No Git sources found. Create a source using the Git plugin to get started.
        </p>
      </div>
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
          <div class="branch-filter">
            <button
              type="button"
              :class="{ active: branchMenuOpen || !!branchFilter }"
              @click="toggleBranchMenu"
            >
              {{ branchButtonLabel }}
            </button>
            <div v-if="branchMenuOpen" class="branch-menu">
              <button
                type="button"
                v-for="branch in availableBranches"
                :key="branch"
                :class="{ active: branchFilter === branch }"
                @click="selectBranchFilter(branch)"
              >
                {{ branch }}
              </button>
            </div>
          </div>
        </div>

        <div class="workspace" :class="{ 'commits-visible': showCommits }">
          <div class="commit-panel" :class="{ visible: showCommits }">
            <div class="commit-list">
              <div v-if="loadingArtifacts && !filteredCommits.length" class="placeholder">Loading commits…</div>
              <div v-else-if="!filteredCommits.length" class="placeholder">
                {{ branchFilter ? 'No commits found for this branch.' : 'No commits found for this source.' }}
              </div>
              <template v-else>
                <ul>
                  <li
                    v-for="artifact in filteredCommits"
                    :key="artifact.id"
                    :class="{ active: artifact.id === selectedArtifactId }"
                    @click="selectArtifact(artifact.id)"
                  >
                    <div class="details">
                      <p class="message">{{ commitMessage(artifact) }}</p>
                      <p class="meta">
                        {{ commitAuthor(artifact) }} · {{ formatDate(commitTimestamp(artifact)) }}
                      </p>
                      <div class="branches" v-if="commitBranchesForDisplay(artifact).length">
                        <span v-for="branch in commitBranchesForDisplay(artifact)" :key="branch">{{ branch }}</span>
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
              </template>
            </div>

          </div>

          <div class="file-panel">
            <div class="file-view">
              <div class="file-view-header" v-if="selectedArtifact">
                <h4>{{ commitMessage(selectedArtifact) }}</h4>
                <p class="meta">
                  {{ shortHash(selectedArtifact) }} · {{ commitAuthor(selectedArtifact) }} ·
                  {{ formatDate(commitTimestamp(selectedArtifact)) }}
                </p>
              </div>
              <GitCommitViewer
                v-if="selectedArtifact && selectedVersion"
                :artifact="selectedArtifact"
                :version="selectedVersion"
                :files="fileArtifacts"
                :files-loading="loadingFiles"
                :snapshot-files="snapshotFiles"
                :snapshot-loading="loadingSnapshot"
                :load-snapshot-file="loadSnapshotFileContent"
              />
              <p v-else-if="loadingArtifacts" class="placeholder">Loading repository files…</p>
              <p v-else class="placeholder">
                {{ branchFilter ? 'No commits match the selected branch.' : 'No commits available for this source.' }}
              </p>
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
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

aside {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  overflow: hidden;
}

.source-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

aside ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

aside header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  min-height: 0;
  overflow: hidden;
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
  flex: 1;
  min-height: 0;
}

.workspace {
  display: flex;
  gap: 0;
  align-items: stretch;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.commit-panel {
  flex: 0 0 320px;
  max-width: 320px;
  width: 320px;
  opacity: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow: hidden;
  min-height: 0;
  pointer-events: none;
  margin-right: -320px;
  transform: translateX(-100%);
  transition: transform 0.3s ease, opacity 0.2s ease, margin-right 0.3s ease;
}

.commit-panel.visible {
  opacity: 1;
  pointer-events: auto;
  margin-right: 0;
  transform: translateX(0);
}

.file-panel {
  flex: 1 1 auto;
  margin-left: 0;
  transition: margin-left 0.3s ease;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.workspace.commits-visible .file-panel {
  margin-left: 1rem;
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

.branch-filter {
  position: relative;
}

.branch-menu {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.15);
  padding: 0.5rem;
  min-width: 200px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.branch-menu button {
  border: 1px solid transparent;
  border-radius: 0.35rem;
  padding: 0.25rem 0.5rem;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.branch-menu button.active {
  background: #eef2ff;
  border-color: #c7d2fe;
}

.commit-list {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  background: #f8fafc;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  min-height: 0;
  overflow: auto;
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

.file-view {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #fff;
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
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
  background: transparent;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
