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
  additions?: number;
  deletions?: number;
  patch?: string;
  binary?: boolean;
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
  artifactId?: string;
  path: string;
  commitHash?: string;
  blobSha?: string;
  mode?: string;
  size?: number;
  encoding?: 'utf8' | 'base64';
  content?: string;
  branches?: string[];
}

interface SnapshotTreeEntry {
  path: string;
  mode?: string;
  size?: number;
  blobSha?: string;
}

type LoadSnapshotFileFn = (path: string) => Promise<FileArtifactData | null>;

const props = defineProps<{
  artifact: ArtifactModel;
  version: ArtifactVersionModel;
  files: ArtifactModel[];
  filesLoading?: boolean;
  showChanges?: boolean;
  snapshotFiles?: SnapshotTreeEntry[];
  snapshotLoading?: boolean;
  loadSnapshotFile?: LoadSnapshotFileFn;
}>();

const commitData = computed<GitCommitData>(() => (props.version?.data ?? {}) as GitCommitData);
const changeList = computed<GitCommitChange[]>(() =>
  Array.isArray(commitData.value.changes) ? commitData.value.changes : []
);
const filesLoading = computed(() => Boolean(props.filesLoading));
const snapshotLoading = computed(() => Boolean(props.snapshotLoading));

const fileArtifacts = computed<FileArtifactData[]>(() =>
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

const fileArtifactMap = computed<Map<string, FileArtifactData>>(() => {
  const map = new Map<string, FileArtifactData>();
  fileArtifacts.value.forEach((entry) => {
    map.set(entry.path, entry);
  });
  return map;
});

type ChangedEntry = {
  path: string;
  change: GitCommitChange;
  file?: FileArtifactData;
};

const changedEntries = computed<ChangedEntry[]>(() =>
  changeList.value.map((change, index) => {
    const entryPath = change.path ?? change.previousPath ?? `unknown-${index}`;
    return {
      path: entryPath,
      change,
      file: fileArtifactMap.value.get(entryPath)
    };
  })
);

const snapshotEntries = computed<SnapshotTreeEntry[]>(() => props.snapshotFiles ?? []);

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
  const trimmed = value.replace(/\/+$/, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\.git$/, '');
  }
  const sshMatch = value.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2].replace(/\.git$/, '')}`;
  }
  return trimmed;
}

type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
  file?: FileArtifactData | SnapshotTreeEntry;
  change?: GitCommitChange;
  fileCount?: number;
};

type TreeInputEntry = {
  path: string;
  file?: FileArtifactData | SnapshotTreeEntry;
  change?: GitCommitChange;
};

const changedTreeNodes = computed<TreeNode[]>(() =>
  buildTree(
    changedEntries.value.map((entry) => ({
      path: entry.path,
      file:
        entry.file ??
        ({
          path: entry.path,
          mode: entry.change.mode,
          size: entry.change.size
        } as FileArtifactData),
      change: entry.change
    }))
  )
);

const snapshotTreeNodes = computed<TreeNode[]>(() =>
  buildTree(snapshotEntries.value.map((entry) => ({ path: entry.path, file: entry })))
);
const changedDirectoryCount = computed(() => countDirectories(changedTreeNodes.value));
const snapshotDirectoryCount = computed(() => countDirectories(snapshotTreeNodes.value));

const changedExpandedPaths = ref<Set<string>>(new Set());
const changedSelectedPath = ref<string>();
const snapshotExpandedPaths = ref<Set<string>>(new Set());
const snapshotSelectedPath = ref<string>();
const snapshotFileCache = ref<Map<string, FileArtifactData>>(new Map());
const snapshotLoadingFile = ref(false);
const snapshotSelectedFile = ref<FileArtifactData>();

watch(
  () => changedEntries.value,
  (list) => {
    changedExpandedPaths.value = new Set();
    changedSelectedPath.value = list[0]?.path;
    if (changedSelectedPath.value) {
      changedExpandedPaths.value = expandAncestors(changedSelectedPath.value, changedExpandedPaths.value);
    }
  },
  { immediate: true }
);

watch(
  () => snapshotEntries.value,
  (list) => {
    snapshotFileCache.value = new Map();
    snapshotSelectedFile.value = undefined;
    snapshotExpandedPaths.value = new Set();
    snapshotSelectedPath.value = list[0]?.path;
    if (snapshotSelectedPath.value) {
      snapshotExpandedPaths.value = expandAncestors(
        snapshotSelectedPath.value,
        snapshotExpandedPaths.value
      );
      void loadSnapshotFileContent(snapshotSelectedPath.value);
    }
  },
  { immediate: true }
);

const changedEntryMap = computed<Map<string, ChangedEntry>>(() => {
  const map = new Map<string, ChangedEntry>();
  changedEntries.value.forEach((entry) => {
    map.set(entry.path, entry);
  });
  return map;
});

const changedSelectedEntry = computed(() =>
  changedSelectedPath.value ? changedEntryMap.value.get(changedSelectedPath.value) : undefined
);

const changedSelectedFile = computed(() => changedSelectedEntry.value?.file);
const changedSelectedChange = computed(() => changedSelectedEntry.value?.change);

async function loadSnapshotFileContent(path: string) {
  if (!props.loadSnapshotFile) {
    snapshotSelectedFile.value = undefined;
    return;
  }
  if (!path) {
    snapshotSelectedFile.value = undefined;
    return;
  }
  const cached = snapshotFileCache.value.get(path);
  if (cached) {
    if (snapshotSelectedPath.value === path) {
      snapshotSelectedFile.value = cached;
    }
    return;
  }
  snapshotLoadingFile.value = true;
  try {
    const file = await props
      .loadSnapshotFile(path)
      .catch((error) => {
        console.error('Unable to load repository file', error);
        return null;
      });
    if (file) {
      snapshotFileCache.value.set(path, file);
      if (snapshotSelectedPath.value === path) {
        snapshotSelectedFile.value = file;
      }
    } else if (snapshotSelectedPath.value === path) {
      snapshotSelectedFile.value = undefined;
    }
  } finally {
    snapshotLoadingFile.value = false;
  }
}

function selectChangedPath(path: string) {
  changedExpandedPaths.value = expandAncestors(path, changedExpandedPaths.value);
  changedSelectedPath.value = path;
}

const selectSnapshotPath = async (path: string) => {
  snapshotExpandedPaths.value = expandAncestors(path, snapshotExpandedPaths.value);
  snapshotSelectedPath.value = path;
  await loadSnapshotFileContent(path);
};

const toggleChangedDirectory = (path: string) => {
  changedExpandedPaths.value = togglePathExpansion(path, changedExpandedPaths.value);
};

const toggleSnapshotDirectory = (path: string) => {
  snapshotExpandedPaths.value = togglePathExpansion(path, snapshotExpandedPaths.value);
};

function downloadArtifactFile(file: FileArtifactData | undefined) {
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

const downloadChangedFile = () => downloadArtifactFile(changedSelectedFile.value);
const downloadSnapshotFile = () => downloadArtifactFile(snapshotSelectedFile.value);

const changedFilePreview = computed(() => buildPreview(changedSelectedFile.value));
const MAX_DIFF_LINES = 2000;
const diffPreview = computed(() => buildDiffLines(changedSelectedChange.value?.patch, MAX_DIFF_LINES));
const visibleDiffLines = computed(() =>
  diffPreview.value.lines.filter((line) => line.kind !== 'info' && line.kind !== 'hunk')
);
const snapshotFilePreview = computed(() => buildPreview(snapshotSelectedFile.value));

const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'];

function isImagePath(path?: string) {
  if (!path) return false;
  const ext = path.split('.').pop()?.toLowerCase();
  return Boolean(ext && imageExtensions.includes(ext));
}

function buildImageDataUrl(file: FileArtifactData) {
  const ext = file.path.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    avif: 'image/avif'
  };
  const mime = mimeMap[ext] ?? 'image/png';
  const base64 = (file.content ?? '').replace(/\s+/g, '');
  return `data:${mime};base64,${base64}`;
}

function normalizeContent(value?: string) {
  if (!value) {
    return '';
  }
  return value.replace(/\r\n/g, '\n');
}

function buildTree(files: TreeInputEntry[]): TreeNode[] {
  const root: Record<string, TreeNode> = {};
  files.forEach((entry) => {
    const segments = entry.path.split('/');
    let cursor: TreeNode | undefined;
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      if (!cursor) {
        root[segment] = root[segment] ?? {
          name: segment,
          path: isFile ? entry.path : segment,
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
            path: isFile ? entry.path : `${cursor.path}/${segment}`,
            type: isFile ? 'file' : 'directory',
            children: []
          };
          cursor.children.push(next);
        }
        cursor = next;
      }
      if (isFile) {
        cursor!.file =
          entry.file ??
          ({
            path: entry.path,
            size: entry.change?.size,
            mode: entry.change?.mode
          } as FileArtifactData);
        cursor!.change = entry.change;
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
      emit('select', node.path);
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
      const isSelected = node.type === 'file' && props.selectedPath === node.path;
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
        node.type === 'directory' ? formatDirectoryMeta(node) : formatFileMeta(node);
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

function formatFileMeta(node: TreeNode) {
  const change = node.change;
  if (change) {
    if (change.status === 'D') {
      return 'Deleted';
    }
    const additions = change.additions ?? 0;
    const deletions = change.deletions ?? 0;
    if (additions || deletions) {
      const parts = [];
      if (additions) {
        parts.push(`+${additions}`);
      }
      if (deletions) {
        parts.push(`-${deletions}`);
      }
      return parts.join(' / ');
    }
    const status = statusLabel(change.status);
    if (status && status !== 'Unknown') {
      return status;
    }
  }
  const sizeValue =
    (node.file as FileArtifactData | SnapshotTreeEntry | undefined)?.size ?? change?.size;
  if (typeof sizeValue === 'number') {
    return formatBytes(sizeValue);
  }
  return '';
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

type FilePreview = {
  text: string;
  truncated: boolean;
  binary: boolean;
  imageUrl?: string;
  isImage?: boolean;
  lines?: Array<{ number: number; text: string }>;
};

function buildPreview(file?: FileArtifactData): FilePreview {
  if (!file?.content) {
    return { text: '', truncated: false, binary: true };
  }
  if (file.encoding === 'base64') {
    if (isImagePath(file.path)) {
      return { text: '', truncated: false, binary: false, imageUrl: buildImageDataUrl(file), isImage: true };
    }
    return { text: '', truncated: false, binary: true };
  }
  const max = 200_000;
  const truncated = file.content.length > max;
  const text = truncated ? file.content.slice(0, max) : file.content;
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map((line, index) => ({
    number: index + 1,
    text: line
  }));
  return { text, truncated, binary: false, lines };
}

type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'info';

type DiffLine = {
  content: string;
  kind: DiffLineKind;
  oldNumber?: number;
  newNumber?: number;
};

function parseDiffHunkHeader(line: string) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) {
    return null;
  }
  return {
    oldStart: Number(match[1]),
    newStart: Number(match[3])
  };
}

function buildDiffLines(patch?: string, maxLines = 2000): { lines: DiffLine[]; truncated: boolean } {
  if (!patch) {
    return { lines: [], truncated: false };
  }
  const normalized = patch.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  const lines: DiffLine[] = [];
  let truncated = false;
  let oldNumber = 0;
  let newNumber = 0;

  const pushLine = (line: DiffLine) => {
    if (lines.length < maxLines) {
      lines.push(line);
    } else {
      truncated = true;
    }
  };

  for (const rawLine of rawLines) {
    if (rawLine.startsWith('@@')) {
      const parsed = parseDiffHunkHeader(rawLine);
      if (parsed) {
        oldNumber = parsed.oldStart;
        newNumber = parsed.newStart;
      }
      pushLine({ content: rawLine, kind: 'hunk' });
      continue;
    }
    if (
      rawLine.startsWith('diff --git') ||
      rawLine.startsWith('index ') ||
      rawLine.startsWith('Binary files ')
    ) {
      pushLine({ content: rawLine, kind: 'info' });
      continue;
    }
    if (rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) {
      pushLine({ content: rawLine, kind: 'info' });
      continue;
    }
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      pushLine({
        content: rawLine,
        kind: 'add',
        newNumber: newNumber
      });
      newNumber += 1;
      continue;
    }
    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      pushLine({
        content: rawLine,
        kind: 'del',
        oldNumber: oldNumber
      });
      oldNumber += 1;
      continue;
    }
    pushLine({
      content: rawLine,
      kind: 'context',
      oldNumber: oldNumber || undefined,
      newNumber: newNumber || undefined
    });
    if (oldNumber) oldNumber += 1;
    if (newNumber) newNumber += 1;
  }

  return { lines, truncated };
}

function expandAncestors(path: string, existing: Set<string>): Set<string> {
  const next = new Set(existing);
  const segments = path.split('/');
  if (segments.length > 1) {
    let current = '';
    segments.slice(0, -1).forEach((segment) => {
      current = current ? `${current}/${segment}` : segment;
      next.add(current);
    });
  }
  return next;
}

function collectDirectoryPathsRecursive(node: TreeNode, target: Set<string>) {
  if (node.type === 'directory') {
    target.add(node.path);
    node.children?.forEach((child) => collectDirectoryPathsRecursive(child, target));
  }
}

function collectAllDirectoryPaths(nodes: TreeNode[]): Set<string> {
  const target = new Set<string>();
  nodes.forEach((node) => collectDirectoryPathsRecursive(node, target));
  return target;
}

function togglePathExpansion(path: string, current: Set<string>): Set<string> {
  const next = new Set(current);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

function expandAllChangedDirectories() {
  changedExpandedPaths.value = collectAllDirectoryPaths(changedTreeNodes.value);
}

function collapseAllChangedDirectories() {
  changedExpandedPaths.value = new Set();
}

function expandAllSnapshotDirectories() {
  snapshotExpandedPaths.value = collectAllDirectoryPaths(snapshotTreeNodes.value);
}

function collapseAllSnapshotDirectories() {
  snapshotExpandedPaths.value = new Set();
}
</script>

<template>
  <div class="git-commit-viewer">
    <section class="summary">
      <div>
        <p class="label">Commit</p>
        <p class="value mono">
          <span>{{ commitHash }}</span>
          <template v-if="repoLink">
            <a :href="`${repoLink}/commit/${commitHash}`" target="_blank" rel="noopener">View on origin</a>
          </template>
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
      <h4>Changed Files Browser ({{ changedEntries.length }})</h4>
      <p v-if="filesLoading" class="placeholder">Loading changed files…</p>
      <div class="repo-browser" v-else-if="changedEntries.length">
        <div class="tree-panel">
          <div class="tree-toolbar">
            <div>
              <p class="label subtle">Changed files tree</p>
              <p class="meta">{{ changedDirectoryCount }} folders · {{ changedEntries.length }} files</p>
            </div>
            <div class="tree-actions">
              <button type="button" class="ghost-button" @click="expandAllChangedDirectories">Expand all</button>
              <button type="button" class="ghost-button" @click="collapseAllChangedDirectories">Collapse all</button>
            </div>
          </div>
          <div class="tree">
            <ul>
              <TreeBranch
                v-for="node in changedTreeNodes"
                :key="node.path"
                :node="node"
                :selected-path="changedSelectedPath"
                :expanded-paths="changedExpandedPaths"
                @select="selectChangedPath"
                @toggle="toggleChangedDirectory"
              />
            </ul>
          </div>
        </div>
        <div class="preview">
          <template v-if="changedSelectedEntry">
            <header>
              <div>
                <h5>{{ changedSelectedEntry.path }}</h5>
                <p>
                  <span>
                    {{
                      typeof (changedSelectedEntry.file?.size ?? changedSelectedChange?.size) === 'number'
                        ? formatBytes(changedSelectedEntry.file?.size ?? changedSelectedChange?.size)
                        : 'Size unknown'
                    }}
                  </span>
                  <span v-if="changedSelectedEntry.file?.mode || changedSelectedChange?.mode">
                    · {{ changedSelectedEntry.file?.mode ?? changedSelectedChange?.mode }}
                  </span>
                </p>
              </div>
              <button
                class="ghost-button"
                type="button"
                @click="downloadChangedFile"
                :disabled="!changedSelectedFile?.content"
              >
                Download
              </button>
            </header>
            <div class="diff-meta">
              <span
                v-if="changedSelectedChange?.status"
                :class="['status-chip', statusClass(changedSelectedChange?.status)]"
                >{{ statusLabel(changedSelectedChange?.status) }}</span
              >
              <div
                class="diff-counts"
                v-if="
                  typeof changedSelectedChange?.additions === 'number' ||
                  typeof changedSelectedChange?.deletions === 'number'
                "
              >
                <span v-if="typeof changedSelectedChange?.additions === 'number'" class="diff-count add">
                  +{{ changedSelectedChange?.additions ?? 0 }}
                </span>
                <span v-if="typeof changedSelectedChange?.deletions === 'number'" class="diff-count del">
                  -{{ changedSelectedChange?.deletions ?? 0 }}
                </span>
              </div>
            </div>
            <div v-if="visibleDiffLines.length" class="diff-view">
              <div
                v-for="(line, index) in visibleDiffLines"
                :key="`diff-line-${index}`"
                :class="['diff-line', `diff-${line.kind}`]"
              >
                <span class="diff-line-number old">{{ line.oldNumber ?? '' }}</span>
                <span class="diff-line-number new">{{ line.newNumber ?? '' }}</span>
                <span class="diff-line-content">{{ line.content || ' ' }}</span>
              </div>
              <p v-if="diffPreview.truncated" class="hint">
                Diff truncated for display. Download the file for the full patch.
              </p>
            </div>
            <p v-else-if="changedSelectedChange?.binary" class="placeholder">
              Binary file diff not available. Download to inspect contents.
            </p>
            <template v-else>
              <template v-if="changedFilePreview.imageUrl">
                <div class="image-preview">
                  <img :src="changedFilePreview.imageUrl" :alt="changedSelectedEntry.path" />
                </div>
              </template>
              <div v-else-if="changedSelectedFile?.content && !changedFilePreview.binary">
                <div class="code-view" v-if="changedFilePreview.lines?.length">
                  <div
                    v-for="line in changedFilePreview.lines"
                    :key="`changed-code-${line.number}`"
                    class="code-line"
                  >
                    <span class="code-line-number">{{ line.number }}</span>
                    <span class="code-line-content">{{ line.text || ' ' }}</span>
                  </div>
                </div>
                <p v-if="changedFilePreview.truncated" class="hint">
                  Preview truncated for large files. Download to view full content.
                </p>
              </div>
              <p v-else class="placeholder">No patch data captured for this file.</p>
            </template>
          </template>
          <div v-else class="preview-empty">
            <p class="placeholder">Select a file from the tree to view its diff.</p>
          </div>
        </div>
      </div>
      <p v-else class="placeholder">No changed files were captured for this commit.</p>
    </section>

    <section class="repository">
      <h4>Repository Files ({{ snapshotEntries.length }})</h4>
      <p v-if="snapshotLoading" class="placeholder">Loading repository files…</p>
      <div class="repo-browser" v-else-if="snapshotEntries.length">
        <div class="tree-panel">
          <div class="tree-toolbar">
            <div>
              <p class="label subtle">Full repository tree</p>
              <p class="meta">{{ snapshotDirectoryCount }} folders · {{ snapshotEntries.length }} files</p>
            </div>
            <div class="tree-actions">
              <button type="button" class="ghost-button" @click="expandAllSnapshotDirectories">Expand all</button>
              <button type="button" class="ghost-button" @click="collapseAllSnapshotDirectories">Collapse all</button>
            </div>
          </div>
          <div class="tree">
            <ul>
              <TreeBranch
                v-for="node in snapshotTreeNodes"
                :key="node.path"
                :node="node"
                :selected-path="snapshotSelectedPath"
                :expanded-paths="snapshotExpandedPaths"
                @select="selectSnapshotPath"
                @toggle="toggleSnapshotDirectory"
              />
            </ul>
          </div>
        </div>
        <div class="preview">
          <template v-if="snapshotSelectedPath">
            <header>
              <div>
                <h5>{{ snapshotSelectedPath }}</h5>
                <p>
                  {{ formatBytes(snapshotSelectedFile?.size) }}
                  <span v-if="snapshotSelectedFile?.mode">· {{ snapshotSelectedFile.mode }}</span>
                </p>
              </div>
              <button
                class="ghost-button"
                type="button"
                @click="downloadSnapshotFile"
                :disabled="snapshotLoadingFile || !snapshotSelectedFile?.content"
              >
                Download
              </button>
            </header>
            <p v-if="snapshotLoadingFile && !snapshotSelectedFile" class="placeholder">Loading file…</p>
            <template v-else-if="snapshotSelectedFile">
              <template v-if="snapshotFilePreview.imageUrl">
                <div class="image-preview">
                  <img :src="snapshotFilePreview.imageUrl" :alt="snapshotSelectedFile.path" />
                </div>
              </template>
              <div v-else-if="snapshotSelectedFile.content && !snapshotFilePreview.binary">
                <div class="code-view" v-if="snapshotFilePreview.lines?.length">
                  <div
                    v-for="line in snapshotFilePreview.lines"
                    :key="`snapshot-code-${line.number}`"
                    class="code-line"
                  >
                    <span class="code-line-number">{{ line.number }}</span>
                    <span class="code-line-content">{{ line.text || ' ' }}</span>
                  </div>
                </div>
                <p v-if="snapshotFilePreview.truncated" class="hint">
                  Preview truncated for large files. Download to view full content.
                </p>
              </div>
              <p v-else class="placeholder">
                {{
                  snapshotSelectedFile.content
                    ? 'Binary file preview not available.'
                    : 'Select a file to load its contents.'
                }}
              </p>
            </template>
          </template>
          <div v-else class="preview-empty">
            <p class="placeholder">Select a file from the tree to view its contents.</p>
          </div>
        </div>
      </div>
      <p v-else class="placeholder">No files available for this commit snapshot.</p>
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
  text-align: left;
}

/* tree lists render inside render-function components, so keep selectors global */
.tree :global(ul) {
  list-style: none;
  margin: 0;
  padding-left: 0.7rem;
  border-left: 1px solid #e2e8f0;
}

.tree > :global(ul) {
  border-left: none;
  padding-left: 0;
}

.tree :global(li ul) {
  padding-left: 0.7rem;
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
  justify-content: flex-start;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: #0f172a;
  transition: background 0.15s ease, color 0.15s ease;
  cursor: pointer;
  width: 100%;
  text-align: left;
  min-width: 0;
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
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:global(.node-meta) {
  font-size: 0.7rem;
  color: #94a3b8;
  white-space: nowrap;
  margin-left: auto;
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

.code-view {
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 0.5rem;
  max-height: 360px;
  overflow: auto;
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  background: rgba(15, 23, 42, 0.7);
}

.code-line {
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0.2rem 0.75rem;
}

.code-line-number {
  text-align: right;
  color: #94a3b8;
}

.code-line-content {
  white-space: pre-wrap;
}

.diff-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.diff-counts {
  display: inline-flex;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.diff-count {
  font-weight: 600;
}

.diff-count.add {
  color: #4ade80;
}

.diff-count.del {
  color: #f87171;
}

.diff-view {
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 0.5rem;
  background: rgba(15, 23, 42, 0.6);
  max-height: 360px;
  overflow: auto;
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.diff-line {
  display: grid;
  grid-template-columns: 3rem 3rem minmax(0, 1fr);
  white-space: pre-wrap;
  padding: 0.1rem 0.5rem;
  font-size: 0.85rem;
}

.diff-line-number {
  text-align: right;
  padding-right: 0.5rem;
  color: #94a3b8;
}

.diff-line-content {
  white-space: pre-wrap;
}

.diff-line.diff-add {
  color: #4ade80;
  background: rgba(34, 197, 94, 0.15);
}

.diff-line.diff-del {
  color: #f87171;
  background: rgba(248, 113, 113, 0.15);
}

.diff-line.diff-hunk {
  color: #facc15;
}

.diff-line.diff-header,
.diff-line.diff-info {
  color: #93c5fd;
}

.diff-line.diff-context {
  color: #e2e8f0;
}

.image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.4);
  padding: 0.5rem;
}

.image-preview img {
  max-width: 100%;
  max-height: 360px;
  border-radius: 0.35rem;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.2);
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
