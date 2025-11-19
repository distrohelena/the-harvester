import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type {
  ArtifactSummary,
  ArtifactVersionSummary,
  ArtifactRepository,
  GitCommitChange,
  GitCommitSearchResult,
  GitCommitSummary,
  GitFileArtifactSummary
} from './artifact-repository.js';
import type { McpServerPlugin, PluginContext } from './plugins/types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_DIFF_FILE_LIMIT = 5;
const MAX_DIFF_FILE_LIMIT = 15;
const MAX_DIFF_TEXT_LENGTH = 20000;
const MAX_DIFF_CONTENT_LENGTH = 500000;

type EnrichedGitFileChange = GitCommitChange & {
  fileArtifactId?: string;
  fileArtifactUri?: string;
  fileDisplayName?: string;
  previousFileArtifactId?: string;
  previousFileArtifactUri?: string;
};

type EnrichedGitCommit = GitCommitSummary & {
  files: EnrichedGitFileChange[];
  artifactUri: string;
};

type GitDiffResult = EnrichedGitFileChange & {
  diff?: string;
  binary?: boolean;
  truncated?: boolean;
  note?: string;
};

const registerGitTools = ({ server, repository, config }: PluginContext) => {
  registerSearchGitCommitsTool(server, repository, config.maxSearchResults);
  registerGitDiffTool(server, repository);
};

export const gitPlugin: McpServerPlugin = {
  key: 'git',
  instructions:
    'Use git-search-commits to browse harvested commit history and git-commit-diff for per-file diffs plus file artifacts.',
  register: (context) => {
    registerGitTools(context);
  }
};

const gitSearchInputSchema = (maxSearchResults: number) =>
  z.object({
    sourceId: z
      .string()
      .min(1)
      .optional()
      .describe('Optional source/project ID. Provide this to limit the search to a single repository.'),
    branch: z
      .string()
      .optional()
      .describe('Filter commits by branch name (exact match).'),
    query: z
      .string()
      .optional()
      .describe('Filter by commit hash prefix, summary, author, or file path (case-insensitive).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(maxSearchResults)
      .optional()
      .describe(`Maximum commits to return (default ${maxSearchResults}).`),
    cursor: z
      .string()
      .optional()
      .describe('Cursor returned from a previous git-search-commits call for pagination.')
  });

const gitCommitChangeSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.string().optional(),
  blobSha: z.string().optional(),
  previousBlobSha: z.string().optional(),
  size: z.number().optional(),
  fileArtifactId: z.string().optional(),
  fileArtifactUri: z.string().optional(),
  previousFileArtifactId: z.string().optional(),
  previousFileArtifactUri: z.string().optional()
});

const gitCommitSchema = z.object({
  artifactId: z.string(),
  artifactUri: z.string(),
  displayName: z.string(),
  commitHash: z.string(),
  message: z.string().optional(),
  branches: z.array(z.string()),
  parents: z.array(z.string()),
  timestamp: z.string().optional(),
  source: z
    .object({
      id: z.string(),
      name: z.string()
    })
    .nullable()
    .optional(),
  author: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      date: z.string().optional()
    })
    .optional(),
  committer: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      date: z.string().optional()
    })
    .optional(),
  files: z.array(gitCommitChangeSchema)
});

const gitSearchOutputSchema = z.object({
  items: z.array(gitCommitSchema),
  nextCursor: z.string().optional()
});

const gitDiffInputSchema = z
  .object({
    commitArtifactId: z
      .string()
      .optional()
      .describe('Artifact ID of the commit (recommended).'),
    sourceId: z
      .string()
      .optional()
      .describe('Source/project ID if you only know the commit hash. Must be paired with commitHash.'),
    commitHash: z
      .string()
      .optional()
      .describe('Commit hash when commitArtifactId is unavailable.'),
    filePath: z
      .string()
      .optional()
      .describe('Optional path filter – only return the diff for this file.'),
    maxFiles: z
      .number()
      .int()
      .min(1)
      .max(MAX_DIFF_FILE_LIMIT)
      .optional()
      .describe(
        `Maximum number of files to diff (default ${DEFAULT_DIFF_FILE_LIMIT}, max ${MAX_DIFF_FILE_LIMIT}).`
      )
  })
  .refine(
    (value) => Boolean(value.commitArtifactId || (value.sourceId && value.commitHash)),
    'Provide commitArtifactId or provide both sourceId and commitHash.'
  );

const gitDiffOutputSchema = z.object({
  commit: gitCommitSchema,
  diffs: z.array(
    gitCommitChangeSchema.extend({
      diff: z.string().optional(),
      binary: z.boolean().optional(),
      truncated: z.boolean().optional(),
      note: z.string().optional()
    })
  )
});

const registerSearchGitCommitsTool = (
  server: McpServer,
  repository: ArtifactRepository,
  maxSearchResults: number
) => {
  server.registerTool(
    'git-search-commits',
    {
      title: 'Search git commits',
      description:
        'Find commit artifacts plus their changed files for a harvested git source. Combine with list-sources to discover source IDs.',
      inputSchema: gitSearchInputSchema(maxSearchResults),
      outputSchema: gitSearchOutputSchema
    },
    async (args) => {
      const searchParams: Parameters<typeof repository.searchGitCommits>[0] = {
        limit: args.limit ?? maxSearchResults
      };
      if (args.sourceId) {
        searchParams.sourceId = args.sourceId;
      }
      if (args.branch) {
        searchParams.branch = args.branch;
      }
      if (args.query) {
        searchParams.query = args.query;
      }
      if (args.cursor) {
        searchParams.cursor = args.cursor;
      }

      const search = await repository.searchGitCommits(searchParams);

      const enriched = await enrichCommitsWithFiles(search, repository);
      const text = enriched.items.length
        ? enriched.items.map(formatCommitSummary).join('\n\n---\n\n')
        : 'No commits matched those filters.';

      return {
        content: [
          {
            type: 'text' as const,
            text
          }
        ],
        structuredContent: {
          items: enriched.items,
          nextCursor: search.nextCursor
        } as unknown as Record<string, unknown>
      };
    }
  );
};

const registerGitDiffTool = (server: McpServer, repository: ArtifactRepository) => {
  server.registerTool(
    'git-commit-diff',
    {
      title: 'Show git commit diff',
      description:
        'Return commit metadata and per-file diffs (text content only) so LLMs can reason about changes.',
      inputSchema: gitDiffInputSchema,
      outputSchema: gitDiffOutputSchema
    },
    async (args) => {
      const commitArtifact = args.commitArtifactId
        ? await repository.getArtifactById(args.commitArtifactId)
        : await repository.findGitCommitByHash(args.commitHash!, args.sourceId);

      if (!commitArtifact) {
        throw new Error('Commit not found. Double-check the artifact ID or commit hash/source pair.');
      }
      if (commitArtifact.pluginKey !== 'git') {
        throw new Error('git-commit-diff only supports git plugin artifacts.');
      }

      const commitData = extractCommitData(commitArtifact);
      if (!commitData) {
        throw new Error('Commit artifact is missing git metadata.');
      }

      const fileExternalIds = commitData.fileExternalIds;
      const fileMap = await repository.findGitFilesByExternalIds(fileExternalIds);
      const fileIndex = buildCommitFileIndex(fileMap);

      const files = resolveFileChanges(commitData, fileIndex);
      const filteredFiles = args.filePath
        ? files.filter(
            (change) =>
              change.path === args.filePath ||
              (change.previousPath && change.previousPath === args.filePath)
          )
        : files;

      const maxFiles = clampNumber(args.maxFiles, DEFAULT_DIFF_FILE_LIMIT, MAX_DIFF_FILE_LIMIT);
      const limitedFiles = filteredFiles.slice(0, maxFiles);

      const parentHash = commitData.parents[0];
      const parentFiles =
        parentHash && limitedFiles.some((file) => file.status !== 'A')
          ? await repository.findGitFilesByCommitAndPaths(
              commitArtifact.source?.id ?? null,
              parentHash,
              limitedFiles
                .filter((file) => file.status !== 'A')
                .map((file) => file.previousPath ?? file.path)
            )
          : new Map<string, GitFileArtifactSummary>();

      const diffs: GitDiffResult[] = [];
      for (const change of limitedFiles) {
        const newFile = fileIndex.get(`${commitData.commitHash}:${change.path}`);
        const previousPath = change.previousPath ?? change.path;
        const previousFile = previousPath ? parentFiles.get(previousPath) : undefined;
        const diff = await buildDiff(change, newFile, previousFile);
        diffs.push(diff);
      }

      const commitSummary: EnrichedGitCommit = {
        ...commitData,
        artifactUri: `artifact://${commitArtifact.id}`,
        files
      };

      const text =
        diffs.length > 0
          ? `${formatCommitSummary(commitSummary)}\n\n` +
            diffs
              .map((diff) => formatDiffSummary(diff))
              .join('\n\n')
          : `${formatCommitSummary(commitSummary)}\n\nNo matching files with textual diffs.`;

      return {
        content: [
          {
            type: 'text' as const,
            text
          }
        ],
        structuredContent: {
          commit: commitSummary,
          diffs
        } as unknown as Record<string, unknown>
      };
    }
  );
};

const enrichCommitsWithFiles = async (
  result: GitCommitSearchResult,
  repository: ArtifactRepository
): Promise<{ items: EnrichedGitCommit[] }> => {
  const externalIds = new Set<string>();
  for (const commit of result.items) {
    commit.fileExternalIds.forEach((id) => externalIds.add(id));
  }
  const fileMap = await repository.findGitFilesByExternalIds(Array.from(externalIds));
  const fileIndex = buildCommitFileIndex(fileMap);

  const items: EnrichedGitCommit[] = result.items.map((commit) => {
    const files = resolveFileChanges(commit, fileIndex);
    return {
      ...commit,
      files,
      artifactUri: `artifact://${commit.artifactId}`
    };
  });

  return { items };
};

const resolveFileChanges = (
  commit: GitCommitSummary,
  fileIndex: Map<string, GitFileArtifactSummary>
): EnrichedGitFileChange[] => {
  const files: EnrichedGitFileChange[] = [];
  for (const change of commit.changes) {
    const key = `${commit.commitHash}:${change.path}`;
    const file = fileIndex.get(key);
    const enriched: EnrichedGitFileChange = { ...change };
    if (file?.artifactId) {
      enriched.fileArtifactId = file.artifactId;
      enriched.fileArtifactUri = `artifact://${file.artifactId}`;
    }
    if (file?.path) {
      enriched.fileDisplayName = file.path;
    }
    files.push(enriched);
  }
  return files;
};

const extractCommitData = (
  artifact: ArtifactSummary
): GitCommitSummary & { fileExternalIds: string[] } | null => {
  const version = artifact.lastVersion as ArtifactVersionSummary | undefined;
  if (!version?.data || typeof version.data !== 'object') {
    return null;
  }
  const summary = mapGitCommitFromVersion(artifact, version);
  return summary;
};

const mapGitCommitFromVersion = (
  artifact: ArtifactSummary,
  version: ArtifactVersionSummary
): (GitCommitSummary & { fileExternalIds: string[] }) => {
  const data = version.data as Record<string, unknown>;
  const base = mapGitCommitFromData(artifact, data);
  return base;
};

const mapGitCommitFromData = (
  artifact: ArtifactSummary,
  data: Record<string, unknown>
): GitCommitSummary & { fileExternalIds: string[] } => {
  const commit: GitCommitSummary = {
    artifactId: artifact.id,
    displayName: artifact.displayName,
    commitHash:
      typeof data.commitHash === 'string' ? data.commitHash : artifact.lastVersion?.version ?? '',
    branches: ensureStringArray(data.branches),
    parents: ensureStringArray(data.parents),
    timestamp: artifact.lastVersion?.timestamp ?? artifact.updatedAt,
    source: artifact.source
      ? {
          id: artifact.source.id,
          name: artifact.source.name
        }
      : null,
    fileExternalIds: ensureStringArray(data.fileArtifacts),
    changes: mapCommitChanges(data.changes)
  };
  if (typeof data.message === 'string') {
    commit.message = data.message;
  }
  const author = buildPersonSummary(
    typeof data.author === 'string' ? data.author : undefined,
    typeof data.authorEmail === 'string' ? data.authorEmail : undefined,
    typeof data.authorDate === 'string' ? data.authorDate : undefined
  );
  if (author) {
    commit.author = author;
  }
  const committer = buildPersonSummary(
    typeof data.committer === 'string' ? data.committer : undefined,
    typeof data.committerEmail === 'string' ? data.committerEmail : undefined,
    typeof data.committerDate === 'string' ? data.committerDate : undefined
  );
  if (committer) {
    commit.committer = committer;
  }
  return commit;
};

const buildCommitFileIndex = (
  map: Map<string, GitFileArtifactSummary>
): Map<string, GitFileArtifactSummary> => {
  const index = new Map<string, GitFileArtifactSummary>();
  map.forEach((summary) => {
    if (summary.commitHash) {
      index.set(`${summary.commitHash}:${summary.path}`, summary);
    }
  });
  return index;
};

const formatCommitSummary = (commit: EnrichedGitCommit): string => {
  const lines: string[] = [];
  lines.push(`${commit.displayName} (${commit.commitHash})`);
  if (commit.source) {
    lines.push(`Source: ${commit.source.name} (${commit.source.id})`);
  }
  if (commit.branches.length) {
    lines.push(`Branches: ${commit.branches.join(', ')}`);
  }
  if (commit.author?.name || commit.author?.date) {
    lines.push(
      `Author: ${commit.author?.name ?? 'Unknown'}${commit.author?.date ? ` @ ${commit.author.date}` : ''}`
    );
  }
  const commitUri = commit.artifactUri;
  lines.push(`Commit artifact: ${commitUri}`);
  if (commit.files.length) {
    lines.push('Changed files:');
    commit.files.forEach((file) => {
      const status = statusLabel(file.status);
      const reference = file.fileArtifactUri ? ` (${file.fileArtifactUri})` : '';
      lines.push(`  • [${status}] ${file.path}${reference}`);
    });
  } else {
    lines.push('No changed files recorded.');
  }
  return lines.join('\n');
};

const formatDiffSummary = (diff: GitDiffResult): string => {
  const lines: string[] = [];
  const status = statusLabel(diff.status);
  lines.push(`File: ${diff.path} [${status}]`);
  if (diff.fileArtifactUri) {
    lines.push(`Current file: ${diff.fileArtifactUri}`);
  }
  if (diff.previousFileArtifactUri) {
    lines.push(`Previous file: ${diff.previousFileArtifactUri}`);
  }
  if (diff.binary) {
    lines.push('Binary file – diff omitted.');
  } else if (diff.note) {
    lines.push(diff.note);
  } else if (diff.diff) {
    lines.push('```diff');
    lines.push(diff.diff.trimEnd());
    lines.push('```');
    if (diff.truncated) {
      lines.push('(Diff truncated)');
    }
  } else {
    lines.push('No textual diff available.');
  }
  return lines.join('\n');
};

const statusLabel = (status?: string) => {
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
    default:
      return status ?? 'Unknown';
  }
};

const buildDiff = async (
  change: EnrichedGitFileChange,
  newFile?: GitFileArtifactSummary,
  previousFile?: GitFileArtifactSummary
): Promise<GitDiffResult> => {
  const result: GitDiffResult = {
    ...change
  };
  if (newFile?.artifactId) {
    result.fileArtifactId = newFile.artifactId;
    result.fileArtifactUri = `artifact://${newFile.artifactId}`;
  }
  if (previousFile?.artifactId) {
    result.previousFileArtifactId = previousFile.artifactId;
    result.previousFileArtifactUri = `artifact://${previousFile.artifactId}`;
  }

  if (!newFile && !previousFile) {
    result.note = 'No artifacts available for this file.';
    return result;
  }

  const isBinary =
    (newFile?.encoding && newFile.encoding !== 'utf8') ||
    (previousFile?.encoding && previousFile.encoding !== 'utf8');
  if (isBinary) {
    result.binary = true;
    result.note = 'Binary content detected. Use the artifact:// URI to inspect the file bytes.';
    return result;
  }

  const newContent = newFile?.content ?? '';
  const previousContent = previousFile?.content ?? '';
  if (
    newContent.length > MAX_DIFF_CONTENT_LENGTH ||
    previousContent.length > MAX_DIFF_CONTENT_LENGTH
  ) {
    result.note = 'Diff skipped because file content is too large.';
    return result;
  }

  try {
    const diffText = await createUnifiedDiff(
      change.previousPath ?? change.path,
      change.path,
      previousContent,
      newContent
    );
    if (!diffText.trim()) {
      result.note = 'No textual differences detected.';
    } else if (diffText.length > MAX_DIFF_TEXT_LENGTH) {
      result.diff = diffText.slice(0, MAX_DIFF_TEXT_LENGTH);
      result.truncated = true;
    } else {
      result.diff = diffText;
    }
  } catch (error) {
    result.note = `Unable to build diff: ${error instanceof Error ? error.message : String(error)}`;
  }

  return result;
};

const createUnifiedDiff = async (
  previousPath: string,
  currentPath: string,
  previousContent: string,
  currentContent: string
): Promise<string> => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'artifact-git-diff-'));
  const oldFile = path.join(tempDir, 'old.txt');
  const newFile = path.join(tempDir, 'new.txt');
  await writeFile(oldFile, previousContent, 'utf8');
  await writeFile(newFile, currentContent, 'utf8');

  try {
    const args = [
      '-u',
      '--label',
      previousPath || 'previous',
      '--label',
      currentPath || 'current',
      oldFile,
      newFile
    ];
    const { stdout } = await execFileAsync('diff', args, {
      maxBuffer: 1024 * 1024,
      encoding: 'utf8'
    });
    return stdout;
  } catch (error: any) {
    // diff exits with code 1 when differences are found, so capture stdout.
    if (error && typeof error.stdout === 'string') {
      return error.stdout;
    }
    if (error && typeof error.message === 'string') {
      throw new Error(error.message);
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const ensureStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry : null))
    .filter((entry): entry is string => Boolean(entry));
};

const mapCommitChanges = (value: unknown): GitCommitChange[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const change = entry as Record<string, unknown>;
      const pathValue = typeof change.path === 'string' ? change.path : undefined;
      if (!pathValue) {
        return null;
      }
      const mapped: GitCommitChange = { path: pathValue };
      if (typeof change.previousPath === 'string') {
        mapped.previousPath = change.previousPath;
      }
      if (typeof change.status === 'string') {
        mapped.status = change.status;
      }
      if (typeof change.blobSha === 'string') {
        mapped.blobSha = change.blobSha;
      }
      if (typeof change.previousBlobSha === 'string') {
        mapped.previousBlobSha = change.previousBlobSha;
      }
      if (typeof change.mode === 'string') {
        mapped.mode = change.mode;
      }
      if (typeof change.previousMode === 'string') {
        mapped.previousMode = change.previousMode;
      }
      if (typeof change.size === 'number') {
        mapped.size = change.size;
      }
      return mapped;
    })
    .filter((entry): entry is GitCommitChange => Boolean(entry));
};

const buildPersonSummary = (
  name?: string,
  email?: string,
  date?: string
): GitCommitSummary['author'] => {
  const summary: { name?: string; email?: string; date?: string } = {};
  if (name) {
    summary.name = name;
  }
  if (email) {
    summary.email = email;
  }
  if (date) {
    summary.date = new Date(date).toISOString();
  }
  return Object.keys(summary).length ? summary : undefined;
};

const clampNumber = (value: number | undefined, fallback: number, max: number) => {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }
  return Math.min(Math.max(value as number, 1), max);
};
