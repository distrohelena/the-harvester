<script setup lang="ts">
import { computed, defineComponent, h, PropType, ref, watch } from 'vue';
import type { ArtifactModel, ArtifactVersionModel } from '../../types/plugins';

type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';

interface GitCommitChange {
  path: string;
  previousPath?: string;
  status?: ChangeStatus;
  blobSha?: string;
  previousBlobSha?: string;
  mode?: string;
  previousMode?: string;
  size?: number;
}

interface GitCommitData {
  commitHash?: string;
  treeHash?: string;
  parents?: string[];
  branches?: string[];
  author?: string;
  authorEmail?: string;
  authorDate?: string;
  committer?: string;
  committerEmail?: string;
  committerDate?: string;
  message?: string;
  changes?: GitCommitChange[];
}

interface FileArtifactData {
  artifactId: string;
  path: string;
  commitHash: string;
  blobSha: string;
  mode?: string;
  size?: number;
  encoding?: 'utf8' | 'base64';
  content?: string;
  branches?: string[];
}

const props = defineProps<{
  artifact: ArtifactModel;
  version: ArtifactVersionModel;
  files: ArtifactModel[];
  filesLoading?: boolean;
  showChanges?: boolean;
}>();

const commitData = computed<GitCommitData>(() => (props.version?.data ?? {}) as GitCommitData);
const changeList = computed<GitCommitChange[]>(() =>
  Array.isArray(commitData.value.changes) ? commitData.value.changes : []
);
const filesLoading = computed(() => Boolean(props.filesLoading));

const fileEntries = computed<FileArtifactData[]>(() =>
  (props.files ?? [])
    .map((artifact) => {
      const data = (artifact.lastVersion?.data ?? {}) as any;
      if (!data || data.artifactType !== 'file') {
        return undefined;
      }
      return {
        artifactId: artifact.id,
        path: data.path ?? artifact.displayName,
        commitHash: data.commitHash ?? artifact.lastVersion?.version ?? props.version.version,
        blobSha: data.blobSha ?? '',
        mode: data.mode,
        size: data.size,
        encoding: (data.encoding as 'utf8' | 'base64') ?? 'utf8',
        content: data.content ?? '',
        branches: data.branches ?? []
      } as FileArtifactData;
    })
    .filter((entry): entry is FileArtifactData => Boolean(entry?.path))
);

const repoLink = computed(() => normalizeRepoUrl(props.artifact.source?.options?.repoUrl));
const commitHash = computed(() => commitData.value.commitHash ?? props.version.version);
const branches = computed(() => commitData.value.branches ?? []);
const parents = computed(() => commitData.value.parents ?? []);
const message = computed(() => commitData.value.message ?? '');
const displayChanges = computed(() => props.showChanges !== false);

const author = computed(() => ({
  name: commitData.value.author ?? 'Unknown',
  email: commitData.value.authorEmail ?? '',
  date: commitData.value.authorDate ?? commitData.value.committerDate ?? props.version.timestamp
}));

const committer = computed(() => ({
  name: commitData.value.committer ?? commitData.value.author ?? 'Unknown',
  email: commitData.value.committerEmail ?? commitData.value.authorEmail ?? '',
  date: commitData.value.committerDate ?? commitData.value.authorDate ?? props.version.timestamp
}));

function formatDate(value?: string) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatBytes(value?: number) {
  if (!Number.isFinite(value ?? NaN)) return 'unknown';
  const bytes = Number(value);
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, index);
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusLabel(status?: ChangeStatus) {
  switch (status) {
    case 'A':
      return 'Added';
    case 'M':
      return 'Modified';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
    case 'C':
      return 'Copied';
    case 'T':
      return 'Type change';
    case 'U':
      return 'Unmerged';
    default:
      return 'Unknown';
  }
}

function statusClass(status?: ChangeStatus) {
  switch (status) {
    case 'A':
      return 'status-add';
    case 'M':
      return 'status-mod';
    case 'D':
      return 'status-del';
    case 'R':
    case 'C':
      return 'status-move';
    default:
      return 'status-other';
  }
}

function normalizeRepoUrl(value?: string) {
  if (!value) {
    return '';
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  const sshMatch = value.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  return value;
}

type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
  file?: FileArtifactData;
  fileCount?: number;
};

const treeNodes = computed<TreeNode[]>(() => buildTree(fileEntries.value));
const fileMap = computed<Map<string, FileArtifactData>>(() => {
  const map = new Map<string, FileArtifactData>();
  fileEntries.value.forEach((entry) => {
    map.set(entry.path, entry);
  });
  return map;
});

const directoryCount = computed(() => countDirectories(treeNodes.value));

const expandedPaths = ref<Set<string>>(new Set());
const selectedPath = ref<string>();
watch(
  () => fileEntries.value,
  (list) => {
    expandedPaths.value = new Set();
    selectedPath.value = list[0]?.path;
    if (selectedPath.value) {
      expandPathAncestors(selectedPath.value);
    }
  },
  { immediate: true }
);

const selectedFile = computed(() => (selectedPath.value ? fileMap.value.get(selectedPath.value) : undefined));

function selectPath(path: string) {
  expandPathAncestors(path);
  selectedPath.value = path;
}

const toggleDirectory = (path: string) => {
  const next = new Set(expandedPaths.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  expandedPaths.value = next;
};

function downloadFile(file: FileArtifactData | undefined) {
  if (!file?.content) return;
  try {
    const filename = file.path.split('/').pop() || 'file';
    let blob: Blob;
    if (file.encoding === 'base64') {
      const binary = atob(file.content);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      blob = new Blob([bytes], { type: 'application/octet-stream' });
    } else {
      blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${commitHash.value}-${filename}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Unable to download file', error);
  }
}

const filePreview = computed(() => buildPreview(selectedFile.value));

function buildTree(files: FileArtifactData[]): TreeNode[] {
  const root: Record<string, TreeNode> = {};
  files.forEach((file) => {
    const segments = file.path.split('/');
    let cursor: TreeNode | undefined;
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      if (!cursor) {
        root[segment] = root[segment] ?? {
          name: segment,
          path: isFile ? file.path : segment,
          type: isFile ? 'file' : 'directory',
          children: []
        };
        cursor = root[segment];
      } else {
        cursor.children = cursor.children ?? [];
        let next = cursor.children.find((child) => child.name === segment);
        if (!next) {
          next = {
            name: segment,
            path: isFile ? file.path : `${cursor.path}/${segment}`,
            type: isFile ? 'file' : 'directory',
            children: []
          };
          cursor.children.push(next);
        }
        cursor = next;
      }
      if (isFile) {
        cursor!.file = file;
        cursor!.type = 'file';
      }
    });
  });

  const sortNodes = (nodes?: TreeNode[]) => {
    if (!nodes) return;
    nodes.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === 'directory' ? -1 : 1;
    });
    nodes.forEach((child) => sortNodes(child.children));
  };

  const list = Object.values(root);
  sortNodes(list);
  list.forEach((node) => annotateCounts(node));
  return list;
}

function annotateCounts(node: TreeNode): number {
  if (node.type === 'file') {
    node.fileCount = 1;
    return 1;
  }
  const total = (node.children ?? []).reduce((sum, child) => sum + annotateCounts(child), 0);
  node.fileCount = total;
  return total;
}

function countDirectories(nodes: TreeNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type === 'directory') {
      return total + 1 + countDirectories(node.children ?? []);
    }
    return total;
  }, 0);
}

const TreeBranch = defineComponent({
  name: 'GitTreeBranch',
  props: {
    node: { type: Object as PropType<TreeNode>, required: true },
    selectedPath: { type: String, default: undefined },
    expandedPaths: { type: Object as PropType<Set<string>>, required: true }
  },
  emits: ['select', 'toggle'],
  setup(props, { emit }) {
    const handleClick = (node: TreeNode) => {
      if (node.type === 'directory') {
        emit('toggle', node.path);
        return;
      }
      if (node.file?.path) {
        emit('select', node.file.path);
      }
    };

    const renderChildren = (children?: TreeNode[]) => {
      if (!children?.length) {
        return null;
      }
      return h(
        'ul',
        {},
        children.map((child) =>
          h(TreeBranch, {
            node: child,
            selectedPath: props.selectedPath,
            expandedPaths: props.expandedPaths,
            onSelect: (path: string) => emit('select', path),
            onToggle: (path: string) => emit('toggle', path),
            key: child.path
          })
        )
      );
    };

    const isDirectoryOpen = () =>
      props.node.type === 'directory' && props.expandedPaths.has(props.node.path);

    return () => {
      const node = props.node;
      const isSelected = node.type === 'file' && props.selectedPath === node.file?.path;
      const classes = [
        'tree-node',
        node.type === 'directory' ? 'directory' : 'file',
        isSelected ? 'selected' : ''
      ];
      const containerClasses = ['tree-item', node.type, isDirectoryOpen() ? 'open' : ''];

      const content: any[] = [];
      if (node.type === 'directory') {
        content.push(
          h(
            'span',
            {
              class: ['toggle-indicator', isDirectoryOpen() ? 'open' : 'closed'],
              role: 'button',
              tabindex: 0,
              onClick: (event: Event) => {
                event.stopPropagation();
                emit('toggle', node.path);
              },
              onKeydown: (event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  emit('toggle', node.path);
                }
              },
              onMousedown: (event: Event) => {
                event.stopPropagation();
              }
            },
            isDirectoryOpen() ? '▾' : '▸'
          )
        );
      } else {
        content.push(h('span', { class: 'toggle-indicator spacer' }, ''));
      }
      const icon = node.type === 'directory' ? renderFolderIcon() : renderFileIcon();
      content.push(
        h(
          'span',
          {
            class: ['node-icon', node.type === 'directory' ? 'folder-icon' : 'file-icon']
          },
          [icon]
        )
      );
      content.push(h('span', { class: 'node-label' }, node.name));
      const metaText =
        node.type === 'directory'
          ? formatDirectoryMeta(node)
          : typeof node.file?.size === 'number'
          ? formatBytes(node.file.size)
          : '';
      if (metaText) {
        content.push(h('span', { class: 'node-meta' }, metaText));
      }

      return h('li', { key: node.path, class: containerClasses.join(' ') }, [
        h(
          'div',
          {
            class: classes.join(' '),
            onClick: () => handleClick(node)
          },
          content
        ),
        node.type === 'directory' && isDirectoryOpen() ? renderChildren(node.children) : null
      ]);
    };
  }
});

function formatDirectoryMeta(node: TreeNode) {
  const folderCount = node.children?.filter((child) => child.type === 'directory').length ?? 0;
  const fileCount = node.fileCount ?? 0;
  const parts: string[] = [];
  if (folderCount > 0) {
    parts.push(`${folderCount} folder${folderCount === 1 ? '' : 's'}`);
  }
  parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function renderFolderIcon() {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: '14',
      height: '14',
      role: 'presentation',
      'aria-hidden': 'true',
      focusable: 'false'
    },
    [
      h('path', {
        d: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5Z',
        fill: 'currentColor'
      })
    ]
  );
}

function renderFileIcon() {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: '14',
      height: '14',
      role: 'presentation',
      'aria-hidden': 'true',
      focusable: 'false'
    },
    [
      h('path', {
        d: 'M7 4.5A1.5 1.5 0 0 1 8.5 3h5.379a1.5 1.5 0 0 1 1.06.44l3.621 3.621A1.5 1.5 0 0 1 19 8.121V19.5A1.5 1.5 0 0 1 17.5 21h-9A1.5 1.5 0 0 1 7 19.5Z',
        fill: 'currentColor'
      })
    ]
  );
}

function buildPreview(file?: FileArtifactData) {
  if (!file?.content) {
    return { text: '', truncated: false, binary: true };
  }
  if (file.encoding === 'base64') {
    return { text: '', truncated: false, binary: true };
  }
  const max = 200_000;
  const truncated = file.content.length > max;
  const text = truncated ? file.content.slice(0, max) : file.content;
  return { text, truncated, binary: false };
}

function expandPathAncestors(path: string) {
  const next = new Set(expandedPaths.value);
  const segments = path.split('/');
  if (segments.length > 1) {
    let current = '';
    segments.slice(0, -1).forEach((segment) => {
      current = current ? `${current}/${segment}` : segment;
      next.add(current);
    });
  }
  expandedPaths.value = next;
}

function collectDirectoryPaths(nodes: TreeNode[], target: Set<string>) {
  nodes.forEach((node) => {
    if (node.type === 'directory') {
      target.add(node.path);
      if (node.children?.length) {
        collectDirectoryPaths(node.children, target);
      }
    }
  });
}

function expandAllDirectories() {
  const next = new Set<string>();
  collectDirectoryPaths(treeNodes.value, next);
  expandedPaths.value = next;
}

function collapseAllDirectories() {
  expandedPaths.value = new Set();
}
</script>

<template>
  <div class="git-commit-viewer">
    <section class="summary">
      <div>
        <p class="label">Commit</p>
        <p class="value mono">
          <span>{{ commitHash }}</span>
          <a
            v-if="repoLink"
            :href="`${repoLink.replace(/\\.git$/, '')}/commit/${commitHash}`"
            target="_blank"
            rel="noopener"
            >View on origin</a
          >
        </p>
      </div>
      <div>
        <p class="label">Tree</p>
        <p class="value mono">{{ commitData.treeHash ?? 'Unknown' }}</p>
      </div>
      <div>
        <p class="label">Branches</p>
        <p class="value">
          <span v-if="branches.length">{{ branches.join(', ') }}</span>
          <span v-else>—</span>
        </p>
      </div>
      <div>
        <p class="label">Parents</p>
        <p class="value mono parents">
          <span v-for="parent in parents" :key="parent">{{ parent }}</span>
          <span v-if="!parents.length">—</span>
        </p>
      </div>
    </section>

    <section class="actors">
      <div>
        <p class="label">Author</p>
        <p class="value">
          {{ author.name }}
          <span v-if="author.email">· {{ author.email }}</span>
        </p>
        <p class="date">{{ formatDate(author.date) }}</p>
      </div>
      <div>
        <p class="label">Committer</p>
        <p class="value">
          {{ committer.name }}
          <span v-if="committer.email">· {{ committer.email }}</span>
        </p>
        <p class="date">{{ formatDate(committer.date) }}</p>
      </div>
    </section>

    <section class="message">
      <h4>Message</h4>
      <pre>{{ message }}</pre>
    </section>

    <section v-if="displayChanges" class="files">
      <h4>
        Changed Files
        <small>({{ changeList.length }})</small>
      </h4>
      <div v-if="changeList.length" class="file-table">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Path</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in changeList" :key="`${file.path}-${file.status}-${file.blobSha}`">
              <td>
                <span :class="['status-chip', statusClass(file.status)]">{{ statusLabel(file.status) }}</span>
              </td>
              <td class="mono">
                {{ file.path }}
                <small v-if="file.previousPath && file.previousPath !== file.path"
                  >← {{ file.previousPath }}</small
                >
              </td>
              <td>{{ formatBytes(file.size) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else>No file changes recorded for this commit.</p>
    </section>

    <section class="repository">
      <h4>Repository Files ({{ fileEntries.length }})</h4>
      <p v-if="filesLoading" class="placeholder">Loading repository files…</p>
      <div class="repo-browser" v-else-if="fileEntries.length">
        <div class="tree-panel">
          <div class="tree-toolbar">
            <div>
              <p class="label subtle">Repository tree</p>
              <p class="meta">{{ directoryCount }} folders · {{ fileEntries.length }} files</p>
            </div>
            <div class="tree-actions">
              <button type="button" class="ghost-button" @click="expandAllDirectories">Expand all</button>
              <button type="button" class="ghost-button" @click="collapseAllDirectories">Collapse all</button>
            </div>
          </div>
          <div class="tree">
            <ul>
              <TreeBranch
                v-for="node in treeNodes"
                :key="node.path"
                :node="node"
                :selected-path="selectedPath"
                :expanded-paths="expandedPaths"
                @select="selectPath"
                @toggle="toggleDirectory"
              />
            </ul>
          </div>
        </div>
        <div class="preview">
          <template v-if="selectedFile">
            <header>
              <div>
                <h5>{{ selectedFile.path }}</h5>
                <p>{{ formatBytes(selectedFile.size) }} · {{ selectedFile.mode }}</p>
              </div>
              <button class="ghost-button" type="button" @click="downloadFile(selectedFile)">
                Download
              </button>
            </header>
            <div v-if="!filePreview.binary">
              <pre>{{ filePreview.text }}</pre>
              <p v-if="filePreview.truncated" class="hint">
                Preview truncated for large files. Download to view full content.
              </p>
            </div>
            <p v-else class="placeholder">Binary file preview not available. Download to view.</p>
          </template>
          <div v-else class="preview-empty">
            <p class="placeholder">Select a file from the tree to view its contents.</p>
          </div>
        </div>
      </div>
      <p v-else class="placeholder">No files available for this commit.</p>
    </section>
  </div>
</template>

<style scoped>
.git-commit-viewer {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.summary,
.actors {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  padding: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  background: #f8fafc;
}

.label {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 0.25rem;
}

.value {
  font-weight: 600;
  color: #0f172a;
}

.value.mono {
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  word-break: break-all;
}

.parents span {
  display: inline-block;
  margin-right: 0.5rem;
}

.actors .date {
  font-size: 0.85rem;
  color: #475569;
  margin-top: 0.125rem;
}

.message,
.files {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #fff;
}

.message pre {
  background: #0f172a;
  color: #f8fafc;
  border-radius: 0.5rem;
  padding: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0.5rem 0 0;
}

.file-table table {
  width: 100%;
  border-collapse: collapse;
}

.file-table th {
  text-align: left;
  font-size: 0.85rem;
  text-transform: uppercase;
  color: #94a3b8;
  border-bottom: 1px solid #e2e8f0;
  padding: 0.5rem;
}

.file-table td {
  padding: 0.5rem;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.file-table tr:last-child td {
  border-bottom: none;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-add {
  background: #dcfce7;
  color: #166534;
}

.status-mod {
  background: #e0f2fe;
  color: #075985;
}

.status-del {
  background: #fee2e2;
  color: #b91c1c;
}

.status-move {
  background: #ede9fe;
  color: #5b21b6;
}

.status-other {
  background: #f1f5f9;
  color: #475569;
}

.actions {
  text-align: right;
}

.ghost-button {
  border: 1px solid #cbd5f5;
  color: #1e3a8a;
  background: #fff;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.ghost-button:hover {
  background: #eef2ff;
}

a {
  font-size: 0.85rem;
  margin-left: 0.5rem;
  color: #2563eb;
}
.repository {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.repo-browser {
  display: grid;
  grid-template-columns: minmax(260px, 320px) 1fr;
  gap: 1rem;
  align-items: stretch;
}

@media (max-width: 960px) {
  .repo-browser {
    grid-template-columns: 1fr;
  }
}

.tree-panel {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  background: #fff;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.tree-toolbar .meta {
  margin: 0;
  color: #475569;
  font-size: 0.8rem;
}

.label.subtle {
  margin-bottom: 0.05rem;
  color: #94a3b8;
  letter-spacing: 0.08em;
}

.tree-actions {
  display: inline-flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.tree-actions .ghost-button {
  padding: 0.1rem 0.5rem;
  font-size: 0.7rem;
  border-radius: 0.35rem;
}

.tree {
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: #fff;
  max-height: 380px;
  overflow: auto;
  font-size: 0.85rem;
}

.tree ul {
  list-style: none;
  margin: 0;
  padding-left: 0.4rem;
  border-left: 1px solid #e2e8f0;
}

.tree > ul {
  border-left: none;
  padding-left: 0;
}

:global(.tree-item) {
  margin: 0.05rem 0;
  padding-left: 0;
  list-style: none;
  cursor: pointer;
  display: block;
  width: 100%;
}

:global(.tree-node) {
  padding: 0.3rem 0.4rem;
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: #0f172a;
  transition: background 0.15s ease, color 0.15s ease;
  cursor: pointer;
  width: 100%;
}

:global(.tree-node.directory) {
  font-weight: 600;
}

:global(.tree-node.selected) {
  background: #dbeafe;
  color: #0f172a;
}

:global(.tree-item:hover > .tree-node:not(.selected)) {
  background: #eff6ff;
  color: #0f172a;
}

:global(.toggle-indicator) {
  width: 0.85rem;
  height: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #94a3b8;
  cursor: pointer;
  user-select: none;
  transition: color 0.2s ease;
}

:global(.toggle-indicator.spacer) {
  cursor: default;
}

:global(.toggle-indicator:hover),
:global(.toggle-indicator.open) {
  color: #0f172a;
}

:global(.node-icon) {
  width: 0.75rem;
  height: 0.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

:global(.node-icon svg) {
  width: 0.75rem;
  height: 0.75rem;
}

:global(.folder-icon) {
  color: #2563eb;
}

:global(.file-icon) {
  color: #0f172a;
}

:global(.node-label) {
  flex: 1;
  user-select: none;
}

:global(.node-meta) {
  font-size: 0.7rem;
  color: #94a3b8;
}

.preview {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 0.75rem;
  background: #0f172a;
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 100%;
  min-height: 320px;
}

.preview header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.preview pre {
  background: rgba(15, 23, 42, 0.85);
  border-radius: 0.5rem;
  padding: 0.75rem;
  overflow: auto;
  white-space: pre-wrap;
  max-height: 360px;
  max-width: 100%;
  width: 100%;
  word-break: break-word;
}

.preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(148, 163, 184, 0.4);
  border-radius: 0.5rem;
  padding: 1rem;
}

.hint {
  font-size: 0.8rem;
  color: #bae6fd;
}

.placeholder {
  color: #64748b;
}
</style>
