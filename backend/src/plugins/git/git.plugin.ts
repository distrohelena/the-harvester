import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  Plugin,
  PluginNavigationPayload,
  NormalizedArtifact,
  PluginExtractContext
} from '../interfaces.js';
import { SourceEntity } from '../../sources/source.entity.js';

interface GitPluginOptions {
  repoUrl?: string;
  branch?: string;
  branches?: string[];
  authToken?: string;
}

interface NormalizedGitOptions {
  repoUrl: string;
  primaryBranch: string;
  branchFilter: string[];
  authToken?: string;
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
}

interface SnapshotEntry {
  path: string;
  mode: string;
  size: number;
  blobSha: string;
  buffer: Buffer;
}

@Injectable()
export class GitPlugin implements Plugin {
  private readonly logger = new Logger(GitPlugin.name);
  private readonly gitCmd = 'git';

  readonly descriptor = {
    key: 'git',
    name: 'Git Commit Extractor',
    optionsSchema: {
      fields: [
        { name: 'repoUrl', label: 'Repository URL', type: 'string', required: true },
        {
          name: 'branch',
          label: 'Branch',
          type: 'string',
          description: 'Defaults to "main" when omitted'
        },
        {
          name: 'branches',
          label: 'Branches (one per line)',
          type: 'array',
          description: 'Optional list of branches to crawl. Leave empty to process every branch.'
        },
        {
          name: 'authToken',
          label: 'Auth Token',
          type: 'string',
          description: 'Optional token for private HTTPS repositories'
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

      for (const commitHash of commits) {
        const branches = Array.from(branchMap.get(commitHash) ?? []);
        const commitMetadata = await this.readCommitMetadata(repoPath, commitHash);
        const snapshotEntries = await this.readCommitSnapshot(repoPath, commitHash);
        const fileArtifacts = snapshotEntries.map((entry) =>
          this.buildFileArtifact(entry, commitHash, options, branches, commitMetadata)
        );
        const snapshotMap = new Map(snapshotEntries.map((entry) => [entry.path, entry]));
        const changes = await this.readCommitChanges(repoPath, commitHash, snapshotMap);
        const commitArtifact = this.buildCommitArtifact(
          commitHash,
          options,
          branches,
          commitMetadata,
          fileArtifacts,
          changes
        );

        await emitBatch([...fileArtifacts, commitArtifact]);
      }
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
    const repoUrl = raw?.repoUrl?.trim();
    if (!repoUrl) {
      throw new BadRequestException('Git plugin requires repoUrl in source options');
    }
    const branchInput = raw?.branch?.trim();
    const branchFilter = this.normalizeBranchList(raw?.branches);
    if (!branchFilter.length && branchInput) {
      branchFilter.push(branchInput);
    }
    const primaryBranch = branchInput || 'main';
    const authToken = raw?.authToken?.trim() || undefined;
    const repoSlug = this.slugify(repoUrl);
    return { repoUrl, primaryBranch, branchFilter, authToken, repoSlug };
  }

  private normalizeBranchList(value?: string[]): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const seen = new Set<string>();
    value.forEach((entry) => {
      const token = entry?.trim();
      if (token) {
        seen.add(token);
      }
    });
    return Array.from(seen);
  }

  private async prepareRepository(options: NormalizedGitOptions): Promise<string> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'harvester-git-'));
    const cloneUrl = this.buildCloneUrl(options.repoUrl, options.authToken);
    const args = ['clone', cloneUrl, tempDir];
    this.logger.log(`GitPlugin cloning ${options.repoUrl}`);
    try {
      await this.runGit(args, { cwd: undefined, displayArgs: this.sanitizeArgs(args) });
      return tempDir;
    } catch (error) {
      await this.cleanupRepository(tempDir);
      throw error;
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
    changes: CommitFileChange[]
  ): NormalizedArtifact {
    const displayName = `${commitHash.slice(0, 7)} ${metadata.subject}`;
    const fileExternalIds = fileArtifacts.map((artifact) => artifact.externalId);

    return {
      externalId: `${options.repoSlug}:${commitHash}`,
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
        snapshotSize: fileArtifacts.length
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
    commitHash: string
  ): Promise<SnapshotEntry[]> {
    const lsOutput = await this.runGit(
      ['ls-tree', '-r', '--full-tree', '--long', commitHash],
      { cwd: repoPath }
    );
    const entries = lsOutput
      .toString('utf8')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => line.match(/^(\d+)\s+(\w+)\s+([0-9a-f]{40})\s+(\d+)\t(.+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        mode: match[1],
        type: match[2],
        sha: match[3],
        size: Number(match[4]),
        path: match[5]
      }))
      .filter((entry) => entry.type === 'blob');

    const files: SnapshotEntry[] = [];
    for (const entry of entries) {
      const buffer = await this.runGit(['cat-file', 'blob', entry.sha], {
        cwd: repoPath,
        encoding: 'buffer'
      });
      files.push({
        path: entry.path,
        mode: entry.mode,
        size: entry.size,
        blobSha: entry.sha,
        buffer
      });
    }
    return files;
  }

  private async readCommitChanges(
    repoPath: string,
    commitHash: string,
    snapshotMap: Map<string, SnapshotEntry>
  ): Promise<CommitFileChange[]> {
    const diffOutput = await this.runGit(
      ['diff-tree', '--root', '--find-renames', '--find-copies', '--always', '-z', commitHash],
      { cwd: repoPath, encoding: 'buffer' }
    );
    const entries = this.parseDiffTree(diffOutput);
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

      if (!isDeletion && !this.isZeroSha(entry.newSha)) {
        const snapshot = snapshotMap.get(pathValue);
        change.size = snapshot?.size ?? change.size;
      }

      files.push(change);
    }
    return files;
  }

  private parseDiffTree(buffer: Buffer): Array<{
    oldMode: string;
    newMode: string;
    oldSha: string;
    newSha: string;
    status: string;
    path: string;
    newPath?: string;
  }> {
    const text = buffer.toString('utf8');
    const segments = text.split('\0').filter((segment) => segment.length > 0);
    const entries: Array<{
      oldMode: string;
      newMode: string;
      oldSha: string;
      newSha: string;
      status: string;
      path: string;
      newPath?: string;
    }> = [];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment.startsWith(':')) {
        continue;
      }
      const match = segment.match(
        /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])(\d{0,3})?\t(.*)$/
      );
      if (!match) {
        continue;
      }
      const [, oldMode, newMode, oldSha, newSha, statusLetter,, pathValue] = match;
      let newPath: string | undefined;
      if ((statusLetter === 'R' || statusLetter === 'C') && index + 1 < segments.length) {
        const candidate = segments[index + 1];
        if (!candidate.startsWith(':')) {
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

  private async cleanupRepository(repoPath: string) {
    try {
      await rm(repoPath, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(`GitPlugin could not clean up ${repoPath}: ${error instanceof Error ? error.message : error}`);
    }
  }

  private buildCloneUrl(repoUrl: string, authToken?: string): string {
    let target = repoUrl;
    const sshMatch = repoUrl.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
      target = `https://${sshMatch[1]}/${sshMatch[2]}`.replace(/\/+$/, '');
    }
    if (!authToken) {
      return target;
    }
    try {
      const parsed = new URL(target);
      if (!parsed.username) {
        parsed.username = 'token';
      }
      parsed.password = authToken;
      return parsed.toString();
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
    options: { cwd?: string; encoding?: BufferEncoding | 'buffer'; displayArgs?: string[] } = {}
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitCmd, args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
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
}
