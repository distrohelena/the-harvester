import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { chmod, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  Plugin,
  PluginNavigationPayload,
  NormalizedArtifact,
  PluginExtractContext
} from '../interfaces.js';
import { SourceEntity } from '../../sources/source.entity.js';
import { ArtifactEntity } from '../../artifacts/artifact.entity.js';

interface GitPluginOptions {
  repoUrl?: string;
  branches?: string | string[];
  authToken?: string;
  sshPrivateKey?: string;
}

interface NormalizedGitOptions {
  repoUrl: string;
  primaryBranch: string;
  branchFilter: string[];
  authToken?: string;
  sshPrivateKey?: string;
  repoSlug: string;
}

interface CommitMetadata {
  hash: string;
  tree: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  message: string;
  subject: string;
}

type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';

interface CommitFileChange {
  path: string;
  previousPath?: string;
  status: ChangeStatus;
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

interface SnapshotEntry {
  path: string;
  mode: string;
  size: number;
  blobSha: string;
  buffer: Buffer;
}

interface SnapshotFileReference {
  path: string;
  mode?: string;
  size?: number;
  blobSha?: string;
  externalId: string;
  sourceCommitHash: string;
}

interface DiffTreeEntry {
  oldMode: string;
  newMode: string;
  oldSha: string;
  newSha: string;
  status: string;
  path: string;
  newPath?: string;
}

interface FilePatchSummary {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
  binary: boolean;
}

@Injectable()
export class GitPlugin implements Plugin {
  private readonly logger = new Logger(GitPlugin.name);
  private readonly gitCmd = 'git';

  constructor(
    @InjectRepository(ArtifactEntity)
    private readonly artifactsRepository: Repository<ArtifactEntity>
  ) {}

  readonly descriptor = {
    key: 'git',
    name: 'Git Commit Extractor',
    optionsSchema: {
      fields: [
        { name: 'repoUrl', label: 'Repository URL', type: 'string', required: true },
        {
          name: 'branches',
          label: 'Branches Included',
          type: 'array',
          description: 'Optional list of branches to crawl (one per line). Leave blank to process every branch.'
        },
        {
          name: 'authToken',
          label: 'Auth Token',
          type: 'string',
          description: 'Optional token for private HTTPS repositories'
        },
        {
          name: 'sshPrivateKey',
          label: 'SSH Private Key',
          type: 'string',
          description: 'Optional private key for git@ style cloning',
          multiline: true
        }
      ]
    },
    artifactSchema: {
      fields: [
        { name: 'artifactType', label: 'Artifact Type', type: 'string', required: true },
        { name: 'commitHash', label: 'Commit Hash', type: 'string', required: true },
        { name: 'treeHash', label: 'Tree Hash', type: 'string', required: true },
        { name: 'parents', label: 'Parent Commits', type: 'array' },
        { name: 'branches', label: 'Branches', type: 'array' },
        { name: 'author', label: 'Author', type: 'string', required: true },
        { name: 'authorEmail', label: 'Author Email', type: 'string', required: true },
        { name: 'authorDate', label: 'Authored At', type: 'string', required: true },
        { name: 'committer', label: 'Committer', type: 'string', required: true },
        { name: 'committerEmail', label: 'Committer Email', type: 'string', required: true },
        { name: 'committerDate', label: 'Committed At', type: 'string', required: true },
        { name: 'message', label: 'Commit Message', type: 'string', required: true },
        {
          name: 'fileArtifacts',
          label: 'File Artifact External IDs',
          type: 'array',
          description: 'References to file artifacts captured for this commit.'
        },
        {
          name: 'changes',
          label: 'Changed Files',
          type: 'array',
          description: 'Diff metadata for files touched in this commit.'
        },
        { name: 'path', label: 'File Path', type: 'string' },
        { name: 'encoding', label: 'File Encoding', type: 'string' },
        { name: 'content', label: 'File Content', type: 'string' }
      ]
    },
    navigationSchema: {
      type: 'timeline',
      label: 'Commit History',
      description: 'Timeline of commits grouped by date'
    }
  } as const;

  async extract(
    source: SourceEntity,
    context?: PluginExtractContext
  ): Promise<NormalizedArtifact[] | void> {
    const options = this.normalizeOptions(source.options as GitPluginOptions);
    const repoPath = await this.prepareRepository(options);
    const collected: NormalizedArtifact[] = [];
    let totalCommitsProcessed = 0;
    let totalChangesCaptured = 0;
    let totalFileArtifactsCaptured = 0;
    const snapshotState = new Map<string, SnapshotFileReference>();
    const emitBatch = async (batch: NormalizedArtifact[]) => {
      if (!batch.length) {
        return;
      }
      if (context?.emitBatch) {
        await context.emitBatch(batch);
      } else {
        collected.push(...batch);
      }
    };

    try {
      const targetBranches = await this.resolveBranches(repoPath, options);
      const { commits, branchMap } = await this.collectCommits(repoPath, targetBranches, options);
      this.logger.log(
        `GitPlugin discovered ${commits.length} commit(s) across ${targetBranches.length} branch(es) for ${options.repoUrl}`
      );

      if (commits.length === 0) {
        this.logger.warn(`GitPlugin did not find commits to process for ${options.repoUrl}.`);
        if (context?.emitBatch) {
          return;
        }
        return [];
      }

      const existingCommits = await this.findExistingCommitExternalIds(
        source.id,
        options.repoSlug,
        commits
      );

      for (const commitHash of commits) {
        const commitExternalId = this.buildCommitExternalId(options.repoSlug, commitHash);
        if (existingCommits.has(commitExternalId)) {
          this.logger.debug(
            `GitPlugin skipping commit ${commitHash} for ${options.repoUrl} (already harvested).`
          );
          continue;
        }

        const branches = Array.from(branchMap.get(commitHash) ?? []);
        const commitMetadata = await this.readCommitMetadata(repoPath, commitHash);
        const changes = await this.readCommitChanges(
          repoPath,
          commitHash,
          commitMetadata.parents.length
        );
        const snapshotEntries = await this.readCommitSnapshot(repoPath, changes);
        const snapshotMap = new Map(snapshotEntries.map((entry) => [entry.path, entry]));
        const fileArtifacts = snapshotEntries.map((entry) =>
          this.buildFileArtifact(entry, commitHash, options, branches, commitMetadata)
        );
        const snapshotReferences = this.updateSnapshotState(snapshotState, changes, fileArtifacts);
        changes.forEach((change) => {
          if (change.status === 'D') {
            return;
          }
          const snapshot = snapshotMap.get(change.path);
          if (snapshot) {
            change.size = snapshot.size;
          }
        });
        const changeCount = changes.length;
        const snapshotCount = snapshotEntries.length;
        if (changeCount === 0) {
          this.logger.warn(
            `GitPlugin detected 0 file change(s) for commit ${commitHash} (${options.repoUrl}). Parents: ${commitMetadata.parents.length}.`
          );
        } else if (snapshotCount === 0) {
          this.logger.warn(
            `GitPlugin parsed ${changeCount} change(s) for commit ${commitHash} but captured 0 snapshot entries.`
          );
        } else {
          this.logger.debug(
            `GitPlugin commit ${commitHash.slice(0, 7)} has ${changeCount} change(s) and ${snapshotCount} snapshot file(s).`
          );
        }
        const commitArtifact = this.buildCommitArtifact(
          commitHash,
          options,
          branches,
          commitMetadata,
          fileArtifacts,
          changes,
          snapshotReferences
        );

        const fileCount = fileArtifacts.length;
        totalCommitsProcessed += 1;
        totalChangesCaptured += changeCount;
        totalFileArtifactsCaptured += fileCount;
        if (fileCount === 0 && changeCount > 0) {
          this.logger.warn(
            `GitPlugin did not capture any file artifacts for commit ${commitHash} despite ${changeCount} detected change(s).`
          );
        }
        this.logger.log(
          `GitPlugin capturing commit ${commitHash.slice(0, 7)} (${options.repoUrl}) with ${changeCount} change(s) and ${fileCount} file artifact(s).`
        );

        await emitBatch([...fileArtifacts, commitArtifact]);
        existingCommits.add(commitExternalId);
      }
      this.logger.log(
        `GitPlugin captured ${totalFileArtifactsCaptured} file artifact(s) across ${totalCommitsProcessed} commit(s) (${totalChangesCaptured} change entries) for ${options.repoUrl}.`
      );
    } finally {
      await this.cleanupRepository(repoPath);
    }

    if (context?.emitBatch) {
      return;
    }
    return collected;
  }

  async buildNavigation(_sourceId: string): Promise<PluginNavigationPayload> {
    return { nodes: [] };
  }

  private normalizeOptions(raw: GitPluginOptions): NormalizedGitOptions {
    const repoUrl = this.normalizeRepoUrl(raw?.repoUrl);
    if (!repoUrl) {
      throw new BadRequestException('Git plugin requires repoUrl in source options');
    }
    const branchFilter = this.normalizeBranchList(raw?.branches);
    const primaryBranch = branchFilter[0] ?? 'main';
    const authToken = raw?.authToken?.trim() || undefined;
    const sshPrivateKey = this.normalizePrivateKey(raw?.sshPrivateKey);
    const repoSlug = this.slugify(repoUrl);
    return { repoUrl, primaryBranch, branchFilter, authToken, sshPrivateKey, repoSlug };
  }

  private normalizeRepoUrl(raw?: string | null): string {
    const value = raw?.trim();
    if (!value) {
      return '';
    }
    return value.replace(/\/+$/, '');
  }

  private normalizeBranchList(value?: string | string[]): string[] {
    if (!value) {
      return [];
    }
    const inputs = Array.isArray(value)
      ? value
      : value
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean);
    const seen = new Set<string>();
    inputs.forEach((entry) => {
      const token = entry?.trim();
      if (token) {
        seen.add(token);
      }
    });
    return Array.from(seen);
  }

  private async prepareRepository(options: NormalizedGitOptions): Promise<string> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'harvester-git-'));
    const cloneUrl = this.buildCloneUrl(
      options.repoUrl,
      options.authToken,
      Boolean(options.sshPrivateKey)
    );
    const args = ['clone', cloneUrl, tempDir];
    this.logger.log(`GitPlugin cloning ${options.repoUrl}`);
    let sshContext:
      | {
          env: NodeJS.ProcessEnv;
          cleanup: () => Promise<void>;
        }
      | undefined;
    if (options.sshPrivateKey) {
      try {
        sshContext = await this.setupSshKey(options.sshPrivateKey);
      } catch (error) {
        await this.cleanupRepository(tempDir);
        throw error;
      }
    }
    try {
      await this.runGit(args, {
        cwd: undefined,
        displayArgs: this.sanitizeArgs(args),
        env: sshContext?.env
      });
      return tempDir;
    } catch (error) {
      await this.cleanupRepository(tempDir);
      throw error;
    } finally {
      await sshContext?.cleanup?.();
    }
  }

  private async resolveBranches(repoPath: string, options: NormalizedGitOptions): Promise<string[]> {
    if (options.branchFilter.length > 0) {
      return options.branchFilter;
    }
    const remoteOutput = await this.runGit(
      ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'],
      { cwd: repoPath }
    );
    const remoteCandidates = remoteOutput
      .toString('utf8')
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.endsWith('/HEAD'));
    if (remoteCandidates.length) {
      return Array.from(new Set(remoteCandidates));
    }

    const localOutput = await this.runGit(
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
      { cwd: repoPath }
    );
    const localCandidates = localOutput
      .toString('utf8')
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (!localCandidates.length) {
      this.logger.warn('GitPlugin did not detect any branches; defaulting to HEAD only.');
      return [options.primaryBranch];
    }
    return Array.from(new Set(localCandidates));
  }

  private async collectCommits(
    repoPath: string,
    branches: string[],
    options: NormalizedGitOptions
  ): Promise<{
    commits: string[];
    branchMap: Map<string, Set<string>>;
  }> {
    const { membership, validBranches } = await this.buildBranchMembership(repoPath, branches);
    if (branches.length > 0 && validBranches.length === 0) {
      throw new BadRequestException(
        `GitPlugin could not find any of the requested branches for ${options.repoUrl}`
      );
    }
    const traversalBranches = validBranches.length > 0 ? validBranches : branches;
    const commits = await this.buildCommitOrder(repoPath, traversalBranches);
    const branchMap = membership;
    return { commits, branchMap };
  }

  private async buildBranchMembership(
    repoPath: string,
    branches: string[]
  ): Promise<{ membership: Map<string, Set<string>>; validBranches: string[] }> {
    const membership = new Map<string, Set<string>>();
    const valid: string[] = [];
    for (const branch of branches) {
      try {
        const output = await this.runGit(['rev-list', branch], { cwd: repoPath });
        output
          .toString('utf8')
          .split('\n')
          .map((hash) => hash.trim())
          .filter(Boolean)
          .forEach((hash) => {
            if (!membership.has(hash)) {
              membership.set(hash, new Set<string>());
            }
            membership.get(hash)!.add(branch);
          });
        valid.push(branch);
      } catch (error) {
        this.logger.warn(
          `GitPlugin could not list commits for branch ${branch}: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }
    return { membership, validBranches: valid };
  }

  private async buildCommitOrder(repoPath: string, branches: string[]): Promise<string[]> {
    const args =
      branches.length > 0
        ? ['rev-list', '--reverse', ...branches]
        : ['rev-list', '--all', '--reverse'];
    const output = await this.runGit(args, { cwd: repoPath });
    const seen = new Set<string>();
    const order: string[] = [];
    output
      .toString('utf8')
      .split('\n')
      .map((hash) => hash.trim())
      .filter(Boolean)
      .forEach((hash) => {
        if (!seen.has(hash)) {
          seen.add(hash);
          order.push(hash);
        }
      });
    return order;
  }

  private buildCommitArtifact(
    commitHash: string,
    options: NormalizedGitOptions,
    branches: string[],
    metadata: CommitMetadata,
    fileArtifacts: NormalizedArtifact[],
    changes: CommitFileChange[],
    snapshotFiles: SnapshotFileReference[]
  ): NormalizedArtifact {
    const displayName = `${commitHash.slice(0, 7)} ${metadata.subject}`;
    const fileExternalIds = fileArtifacts.map((artifact) => artifact.externalId);
    const externalId = this.buildCommitExternalId(options.repoSlug, commitHash);

    return {
      externalId,
      displayName,
      version: commitHash,
      data: {
        artifactType: 'commit',
        commitHash,
        treeHash: metadata.tree,
        parents: metadata.parents,
        branches,
        author: metadata.authorName,
        authorEmail: metadata.authorEmail,
        authorDate: metadata.authorDate,
        committer: metadata.committerName,
        committerEmail: metadata.committerEmail,
        committerDate: metadata.committerDate,
        message: metadata.message,
        fileArtifacts: fileExternalIds,
        changes,
        snapshotSize: snapshotFiles.length,
        snapshotFiles
      },
      metadata: {
        repoUrl: options.repoUrl,
        primaryBranch: options.primaryBranch,
        branches,
        parents: metadata.parents,
        artifactType: 'commit'
      },
      originalUrl: options.repoUrl,
      timestamp: metadata.committerDate
    };
  }

  private async readCommitMetadata(repoPath: string, commitHash: string): Promise<CommitMetadata> {
    const formatTokens = [
      '%H',
      '%T',
      '%P',
      '%an',
      '%ae',
      '%ad',
      '%cn',
      '%ce',
      '%cd',
      '%B'
    ];
    const output = await this.runGit(
      ['show', '-s', `--format=${formatTokens.join('%n')}`, '--date=iso-strict', commitHash],
      { cwd: repoPath }
    );
    const lines = output.toString('utf8').split('\n');
    const [
      hash,
      tree,
      parentsLine,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
      ...messageParts
    ] = lines;
    const message = messageParts.join('\n').replace(/\s+$/, '');
    const parents = parentsLine ? parentsLine.split(' ').filter(Boolean) : [];
    const subjectLine = message.split('\n').find((line) => line.trim().length > 0) ?? hash;
    return {
      hash,
      tree,
      parents,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
      message,
      subject: subjectLine.trim()
    };
  }

  private async readCommitSnapshot(
    repoPath: string,
    changes: CommitFileChange[]
  ): Promise<SnapshotEntry[]> {
    if (!changes?.length) {
      return [];
    }
    const files: SnapshotEntry[] = [];
    for (const change of changes) {
      if (
        change.status === 'D' ||
        !change.blobSha ||
        this.isZeroSha(change.blobSha)
      ) {
        continue;
      }
      const buffer = await this.runGit(['cat-file', 'blob', change.blobSha], {
        cwd: repoPath,
        encoding: 'buffer'
      });
      files.push({
        path: change.path,
        mode: change.mode ?? '100644',
        size: buffer.length,
        blobSha: change.blobSha,
        buffer
      });
    }
    return files;
  }

  private async readCommitChanges(
    repoPath: string,
    commitHash: string,
    parentCount: number
  ): Promise<CommitFileChange[]> {
    const diffTreeArgs = parentCount > 1 ? ['--cc'] : [];
    let entries = await this.loadDiffEntries(repoPath, commitHash, diffTreeArgs);

    if (!entries.length && parentCount > 0) {
      entries = await this.loadDiffEntries(repoPath, commitHash);
    }

    let fallbackToShow = false;
    if (!entries.length) {
      fallbackToShow = true;
      const showArgs = [
        'show',
        '--raw',
        '--format=',
        '--find-renames',
        '--find-copies',
        '--no-abbrev',
        '-z'
      ];
      if (parentCount > 1) {
        showArgs.push('-m');
      }
      showArgs.push(commitHash);
      const showOutput = await this.runGit(showArgs, {
        cwd: repoPath,
        encoding: 'buffer'
      });
      entries = this.parseDiffTree(showOutput);
    }

    if (!entries.length) {
      const reason = fallbackToShow
        ? 'git diff-tree and git show --raw returned no entries'
        : 'git diff-tree returned no entries';
      this.logger.warn(`GitPlugin could not determine file changes for commit ${commitHash}: ${reason}.`);
      return [];
    }

    const patchSummaries = await this.readCommitPatches(repoPath, commitHash);
    const files: CommitFileChange[] = [];
    for (const entry of entries) {
      const status = entry.status as ChangeStatus;
      const isDeletion = status === 'D';
      const pathValue = entry.newPath ?? entry.path;
      const change: CommitFileChange = {
        path: pathValue,
        previousPath: status === 'R' || status === 'C' ? entry.path : undefined,
        status,
        blobSha: isDeletion ? undefined : entry.newSha,
        previousBlobSha: isDeletion ? entry.oldSha : undefined,
        mode: isDeletion ? entry.oldMode : entry.newMode,
        previousMode: entry.oldMode
      };
      const patchInfo = patchSummaries.get(change.path);
      if (patchInfo) {
        change.additions = patchInfo.additions;
        change.deletions = patchInfo.deletions;
        change.patch = patchInfo.patch;
        change.binary = patchInfo.binary;
      }

      files.push(change);
    }
    return files;
  }

  private async loadDiffEntries(
    repoPath: string,
    target: string,
    extraArgs: string[] = []
  ): Promise<DiffTreeEntry[]> {
    const diffOutput = await this.runGit(
      [
        'diff-tree',
        ...extraArgs,
        '-r',
        '--root',
        '--find-renames',
        '--find-copies',
        '--always',
        '--no-abbrev',
        '-z',
        target
      ],
      { cwd: repoPath, encoding: 'buffer' }
    );
    return this.parseDiffTree(diffOutput);
  }

  private parseDiffTree(buffer: Buffer): DiffTreeEntry[] {
    const text = buffer.toString('utf8');
    const segments = text.split('\0').filter((segment, index, source) => {
      // Keep empty trailing segment to preserve indexing for rename new paths
      if (segment.length > 0) {
        return true;
      }
      const next = source[index + 1];
      return typeof next === 'string' && next.startsWith(':');
    });
    const entries: DiffTreeEntry[] = [];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment.startsWith(':')) {
        continue;
      }
      const match = segment.match(
        /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])(\d{0,3})?$/
      );
      if (!match) {
        continue;
      }
      const [, oldMode, newMode, oldSha, newSha, statusLetter] = match;
      const pathValue = segments[index + 1];
      if (typeof pathValue !== 'string' || pathValue.startsWith(':')) {
        continue;
      }
      index += 1;
      let newPath: string | undefined;
      if (statusLetter === 'R' || statusLetter === 'C') {
        const candidate = segments[index + 1];
        if (typeof candidate === 'string' && !candidate.startsWith(':')) {
          newPath = candidate;
          index += 1;
        }
      }
      entries.push({
        oldMode,
        newMode,
        oldSha,
        newSha,
        status: statusLetter,
        path: pathValue,
        newPath
      });
    }

    return entries;
  }

  private async readCommitPatches(
    repoPath: string,
    commitHash: string
  ): Promise<Map<string, FilePatchSummary>> {
    try {
      const patchOutput = await this.runGit(
        [
          'show',
          '--patch',
          '--unified=2000',
          '--format=',
          '--find-renames',
          '--find-copies',
          '--no-color',
          '--no-ext-diff',
          commitHash
        ],
        { cwd: repoPath }
      );
      return this.parsePatchSummaries(patchOutput.toString('utf8'));
    } catch (error) {
      this.logger.warn(
        `GitPlugin could not read patch data for commit ${commitHash}: ${
          error instanceof Error ? error.message : error
        }`
      );
      return new Map();
    }
  }

  private parsePatchSummaries(text: string): Map<string, FilePatchSummary> {
    const summaries = new Map<string, FilePatchSummary>();
    const lines = text.split('\n');
    let currentPath: string | undefined;
    let buffer: string[] = [];
    let additions = 0;
    let deletions = 0;
    let binary = false;

    const flush = () => {
      if (!currentPath || buffer.length === 0) {
        buffer = [];
        additions = 0;
        deletions = 0;
        binary = false;
        currentPath = undefined;
        return;
      }
      summaries.set(currentPath, {
        path: currentPath,
        additions,
        deletions,
        patch: buffer.join('\n'),
        binary
      });
      buffer = [];
      additions = 0;
      deletions = 0;
      binary = false;
      currentPath = undefined;
    };

    for (const rawLine of lines) {
      if (rawLine.startsWith('diff --git ')) {
        flush();
        currentPath = this.extractPathFromDiffHeader(rawLine);
        buffer = [rawLine];
        continue;
      }
      if (!currentPath) {
        continue;
      }
      buffer.push(rawLine);
      if (rawLine.startsWith('Binary files ')) {
        binary = true;
        continue;
      }
      if (rawLine.startsWith('+++ ')) {
        const pathCandidate = this.normalizeDiffPath(rawLine.slice(4).trim());
        if (pathCandidate) {
          currentPath = pathCandidate;
        }
        continue;
      }
      if (rawLine.startsWith('--- ')) {
        continue;
      }
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        additions += 1;
      } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
        deletions += 1;
      }
    }
    flush();
    return summaries;
  }

  private extractPathFromDiffHeader(line: string): string | undefined {
    const match = line.match(/^diff --git (.+) (.+)$/);
    if (!match) {
      return undefined;
    }
    const [, left, right] = match;
    return this.normalizeDiffPath(right) ?? this.normalizeDiffPath(left);
  }

  private normalizeDiffPath(raw?: string): string | undefined {
    if (!raw) {
      return undefined;
    }
    let value = raw.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (value === '/dev/null') {
      return undefined;
    }
    if (value.startsWith('a/')) {
      value = value.slice(2);
    } else if (value.startsWith('b/')) {
      value = value.slice(2);
    }
    return value;
  }

  private isZeroSha(sha?: string): boolean {
    return !sha || /^0+$/.test(sha);
  }

  private buildFileArtifact(
    entry: SnapshotEntry,
    commitHash: string,
    options: NormalizedGitOptions,
    branches: string[],
    commitMetadata: CommitMetadata
  ): NormalizedArtifact {
    const isText = this.isLikelyText(entry.buffer);
    const encoding = isText ? 'utf8' : 'base64';
    const content = isText ? entry.buffer.toString('utf8') : entry.buffer.toString('base64');
    const externalId = this.buildFileExternalId(options.repoSlug, commitHash, entry.path);

    return {
      externalId,
      displayName: entry.path,
      version: commitHash,
      data: {
        artifactType: 'file',
        path: entry.path,
        commitHash,
        blobSha: entry.blobSha,
        mode: entry.mode,
        size: entry.size,
        encoding,
        content,
        branches
      },
      metadata: {
        artifactType: 'file',
        repoUrl: options.repoUrl,
        commitHash,
        path: entry.path,
        blobSha: entry.blobSha,
        mode: entry.mode,
        size: entry.size,
        branches
      },
      originalUrl: `${options.repoUrl.replace(/\.git$/, '')}/blob/${commitHash}/${entry.path}`,
      timestamp: commitMetadata.committerDate
    };
  }

  private buildFileExternalId(repoSlug: string, commitHash: string, filePath: string): string {
    const hash = createHash('sha1').update(filePath).digest('hex').slice(0, 16);
    return `${repoSlug}:file:${commitHash}:${hash}`;
  }

  private buildCommitExternalId(repoSlug: string, commitHash: string): string {
    return `${repoSlug}:${commitHash}`;
  }

  private updateSnapshotState(
    state: Map<string, SnapshotFileReference>,
    changes: CommitFileChange[],
    fileArtifacts: NormalizedArtifact[]
  ): SnapshotFileReference[] {
    const artifactByPath = new Map<string, NormalizedArtifact>();
    fileArtifacts.forEach((artifact) => {
      const artifactPath: string | undefined = (artifact.data as any)?.path;
      if (artifactPath) {
        artifactByPath.set(artifactPath, artifact);
      }
    });

    for (const change of changes) {
      if (change.status === 'D') {
        state.delete(change.path);
        continue;
      }
      if ((change.status === 'R' || change.status === 'C') && change.previousPath) {
        state.delete(change.previousPath);
      }
      const artifact = artifactByPath.get(change.path);
      if (artifact) {
        state.set(change.path, this.buildSnapshotReference(artifact));
      }
    }

    return Array.from(state.values()).map((entry) => ({ ...entry }));
  }

  private buildSnapshotReference(artifact: NormalizedArtifact): SnapshotFileReference {
    const data = artifact.data as any;
    return {
      path: data.path,
      mode: data.mode,
      size: data.size,
      blobSha: data.blobSha,
      externalId: artifact.externalId,
      sourceCommitHash: data.commitHash
    };
  }

  private isLikelyText(buffer: Buffer): boolean {
    const sample = buffer.slice(0, 4096);
    for (let index = 0; index < sample.length; index += 1) {
      const code = sample[index];
      if (code === 0) {
        return false;
      }
    }
    return true;
  }

  private async findExistingCommitExternalIds(
    sourceId: string,
    repoSlug: string,
    commitHashes: string[]
  ): Promise<Set<string>> {
    if (!commitHashes.length) {
      return new Set();
    }
    const externalIds = commitHashes.map((hash) => this.buildCommitExternalId(repoSlug, hash));
    const rows = await this.artifactsRepository
      .createQueryBuilder('artifact')
      .select('artifact.externalId', 'externalId')
      .where('artifact.source_id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'git' })
      .andWhere('artifact.externalId IN (:...externalIds)', { externalIds })
      .getRawMany<{ externalId: string }>();
    return new Set(rows.map((row) => row.externalId));
  }

  private async cleanupRepository(repoPath: string) {
    try {
      await rm(repoPath, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(`GitPlugin could not clean up ${repoPath}: ${error instanceof Error ? error.message : error}`);
    }
  }

  private buildCloneUrl(repoUrl: string, authToken?: string, useSsh?: boolean): string {
    if (useSsh) {
      return repoUrl;
    }
    let target = repoUrl;
    const sshMatch = repoUrl.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
      target = `https://${sshMatch[1]}/${sshMatch[2]}`.replace(/\/+$/, '');
    }
    target = target.replace(/\/+$/, '');
    if (!authToken) {
      return target;
    }
    try {
      const parsed = new URL(target);
      if (!parsed.username) {
        parsed.username = 'token';
      }
      parsed.password = authToken;
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return target;
    }
  }

  private sanitizeArgs(args: string[]): string[] {
    return args.map((arg) => {
      if (arg.includes('token') || arg.includes('@')) {
        return '[secure]';
      }
      return arg;
    });
  }

  private slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'git';
  }

  private runGit(
    args: string[],
    options: {
      cwd?: string;
      encoding?: BufferEncoding | 'buffer';
      displayArgs?: string[];
      env?: NodeJS.ProcessEnv;
    } = {}
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const env = options.env ? { ...process.env, ...options.env } : process.env;
      const child = spawn(this.gitCmd, args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(stdout));
        } else {
          const command = `${this.gitCmd} ${(options.displayArgs ?? args).join(' ')}`;
          const error = Buffer.concat(stderr).toString('utf8');
          reject(new Error(`${command} failed (exit ${code}): ${error}`));
        }
      });
    });
  }

  private normalizePrivateKey(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
      return undefined;
    }
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  }

  private async setupSshKey(privateKey: string): Promise<{
    env: NodeJS.ProcessEnv;
    cleanup: () => Promise<void>;
  }> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'harvester-git-ssh-'));
    const keyPath = path.join(tempDir, 'id');
    try {
      await writeFile(keyPath, privateKey, { mode: 0o600 });
      await chmod(keyPath, 0o600);
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    }

    const env = {
      GIT_SSH_COMMAND:
        `ssh -i ${keyPath} ` +
        '-o IdentitiesOnly=yes ' +
        '-o StrictHostKeyChecking=no ' +
        '-o UserKnownHostsFile=/dev/null'
    };

    return {
      env,
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true });
      }
    };
  }
}
