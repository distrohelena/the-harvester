import { Pool } from 'pg';
import { Buffer } from 'node:buffer';

export interface ArtifactVersionSummary {
  id: string;
  version: string;
  metadata?: Record<string, unknown> | null | undefined;
  data?: Record<string, unknown> | null | undefined;
  originalUrl?: string | null | undefined;
  timestamp?: string | null | undefined;
  checksum?: string | undefined;
  createdAt?: string | undefined;
}

export interface ArtifactSummary {
  id: string;
  displayName: string;
  pluginKey: string;
  externalId: string;
  source?: {
    id: string;
    name: string;
    pluginKey: string;
  } | null;
  lastVersion?: ArtifactVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceSummary {
  id: string;
  name: string;
  pluginKey: string;
  artifactCount: number;
}

export interface SearchArtifactsParams {
  query?: string | undefined;
  pluginKey?: string | undefined;
  sourceId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface SearchArtifactsResult {
  items: ArtifactSummary[];
  nextCursor?: string | undefined;
}

export interface GitCommitChange {
  path: string;
  previousPath?: string;
  status?: string;
  blobSha?: string;
  previousBlobSha?: string;
  mode?: string;
  previousMode?: string;
  size?: number;
}

export interface GitCommitSummary {
  artifactId: string;
  displayName: string;
  commitHash: string;
  message?: string;
  author?: {
    name?: string;
    email?: string;
    date?: string;
  };
  committer?: {
    name?: string;
    email?: string;
    date?: string;
  };
  branches: string[];
  parents: string[];
  timestamp?: string | null;
  source?: {
    id: string;
    name: string;
  } | null;
  fileExternalIds: string[];
  changes: GitCommitChange[];
}

export interface GitCommitSearchParams {
  sourceId?: string;
  branch?: string;
  query?: string;
  limit?: number;
  cursor?: string;
}

export interface GitCommitSearchResult {
  items: GitCommitSummary[];
  nextCursor?: string;
}

export interface GitFileArtifactSummary {
  artifactId: string;
  externalId: string;
  sourceId?: string | null;
  path: string;
  commitHash: string;
  encoding?: string;
  content?: string;
  size?: number;
  branches?: string[];
}

const DEFAULT_SEARCH_LIMIT = 25;
const MAX_SEARCH_LIMIT = 50;

const encodeCursor = (value: { updatedAt: string; id: string }) =>
  Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');

const decodeCursor = (cursor?: string | null) => {
  if (!cursor) {
    return undefined;
  }

  try {
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    const raw = Buffer.from(normalized + '='.repeat(pad), 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.updatedAt === 'string' && typeof parsed.id === 'string') {
      return parsed as { updatedAt: string; id: string };
    }
  } catch (error) {
    console.warn('Failed to decode cursor', error);
  }

  return undefined;
};

type ArtifactSummaryRow = {
  id: string;
  display_name: string;
  plugin_key: string;
  external_id: string;
  source_id: string | null;
  source_name: string | null;
  source_plugin_key: string | null;
  last_version_id: string | null;
  version: string | null;
  version_metadata: Record<string, unknown> | null;
  version_data: Record<string, unknown> | null;
  original_url: string | null;
  version_timestamp: string | null;
  checksum: string | null;
  version_created_at: string | null;
  created_at: string;
  updated_at: string;
};

type SourceRow = {
  id: string;
  name: string;
  plugin_key: string;
  artifact_count: string;
};

type GitFileRow = {
  artifact_id: string;
  external_id: string;
  source_id: string | null;
  version_data: Record<string, unknown> | null;
};

export class ArtifactRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async searchArtifacts(params: SearchArtifactsParams): Promise<SearchArtifactsResult> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
    const where: string[] = [];
    const values: Array<string | number> = [];
    let index = 1;

    if (params.query) {
      const like = `%${params.query}%`;
      values.push(like);
      where.push(
        `(
          a."displayName" ILIKE $${index}
          OR a."externalId" ILIKE $${index}
          OR s."name" ILIKE $${index}
          OR a."pluginKey" ILIKE $${index}
          OR v.version ILIKE $${index}
          OR CAST(v.data AS TEXT) ILIKE $${index}
          OR CAST(v.metadata AS TEXT) ILIKE $${index}
        )`
      );
      index += 1;
    }

    if (params.pluginKey) {
      values.push(params.pluginKey);
      where.push(`a."pluginKey" = $${index}`);
      index += 1;
    }

    if (params.sourceId) {
      values.push(params.sourceId);
      where.push(`a.source_id = $${index}`);
      index += 1;
    }

    const cursor = decodeCursor(params.cursor);
    if (cursor) {
      values.push(cursor.updatedAt, cursor.id);
      where.push(`(a."updatedAt", a.id) < ($${index}, $${index + 1})`);
      index += 2;
    }

    values.push(limit);

    const query = `
      SELECT
        a.id,
        a."displayName" AS display_name,
        a."pluginKey" AS plugin_key,
        a."externalId" AS external_id,
        s.id AS source_id,
        s."name" AS source_name,
        s."pluginKey" AS source_plugin_key,
        a.last_version_id,
        v.version,
        v.metadata AS version_metadata,
        v.data AS version_data,
        v."originalUrl" AS original_url,
        v.timestamp AS version_timestamp,
        v.checksum,
        v."createdAt" AS version_created_at,
        a."createdAt" AS created_at,
        a."updatedAt" AS updated_at
      FROM artifacts a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN artifact_versions v ON v.id = a.last_version_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a."updatedAt" DESC, a.id DESC
      LIMIT $${index}
    `;

    const result = await this.pool.query<ArtifactSummaryRow>(query, values);
    const items = result.rows.map(mapArtifactSummaryRow);

    let nextCursor: string | undefined;
    if (items.length === limit && items.length > 0) {
      const last = items[items.length - 1];
      if (last) {
        nextCursor = encodeCursor({ updatedAt: last.updatedAt, id: last.id });
      }
    }

    return { items, nextCursor };
  }

  async listRecentArtifacts(limit: number): Promise<ArtifactSummary[]> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_SEARCH_LIMIT);
    const query = `
      SELECT
        a.id,
        a."displayName" AS display_name,
        a."pluginKey" AS plugin_key,
        a."externalId" AS external_id,
        s.id AS source_id,
        s."name" AS source_name,
        s."pluginKey" AS source_plugin_key,
        a.last_version_id,
        v.version,
        v.metadata AS version_metadata,
        v.data AS version_data,
        v."originalUrl" AS original_url,
        v.timestamp AS version_timestamp,
        v.checksum,
        v."createdAt" AS version_created_at,
        a."createdAt" AS created_at,
        a."updatedAt" AS updated_at
      FROM artifacts a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN artifact_versions v ON v.id = a.last_version_id
      ORDER BY a."updatedAt" DESC, a.id DESC
      LIMIT $1
    `;

    const { rows } = await this.pool.query<ArtifactSummaryRow>(query, [safeLimit]);
    return rows.map(mapArtifactSummaryRow);
  }

  async getArtifactById(id: string): Promise<ArtifactSummary | null> {
    const query = `
      SELECT
        a.id,
        a."displayName" AS display_name,
        a."pluginKey" AS plugin_key,
        a."externalId" AS external_id,
        s.id AS source_id,
        s."name" AS source_name,
        s."pluginKey" AS source_plugin_key,
        a.last_version_id,
        v.version,
        v.metadata AS version_metadata,
        v.data AS version_data,
        v."originalUrl" AS original_url,
        v.timestamp AS version_timestamp,
        v.checksum,
        v."createdAt" AS version_created_at,
        a."createdAt" AS created_at,
        a."updatedAt" AS updated_at
      FROM artifacts a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN artifact_versions v ON v.id = a.last_version_id
      WHERE a.id = $1
      LIMIT 1
    `;

    const { rows } = await this.pool.query<ArtifactSummaryRow>(query, [id]);
    const row = rows[0];
    return row ? mapArtifactSummaryRow(row) : null;
  }

  async completeArtifactId(partial: string, limit = 5): Promise<string[]> {
    const like = `${partial}%`;
    const query = `
      SELECT a.id
      FROM artifacts a
      WHERE a.id ILIKE $1 OR a."displayName" ILIKE $2
      ORDER BY a."updatedAt" DESC
      LIMIT $3
    `;

    const { rows } = await this.pool.query<{ id: string }>(query, [like, `%${partial}%`, limit]);
    return rows.map((row) => row.id);
  }

  async listSources(limit = 1000): Promise<SourceSummary[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 2000);
    const query = `
      SELECT
        s.id,
        s."name" AS name,
        s."pluginKey" AS plugin_key,
        COUNT(a.id)::text AS artifact_count
      FROM sources s
      LEFT JOIN artifacts a ON a.source_id = s.id
      WHERE s."isActive" = true
      GROUP BY s.id, s."name", s."pluginKey"
      ORDER BY s."name" ASC
      LIMIT $1
    `;

    const { rows } = await this.pool.query<SourceRow>(query, [safeLimit]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      pluginKey: row.plugin_key,
      artifactCount: Number(row.artifact_count) || 0
    }));
  }

  async searchGitCommits(params: GitCommitSearchParams): Promise<GitCommitSearchResult> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
    const where: string[] = [
      `a."pluginKey" = 'git'`,
      `(v.data ->> 'artifactType') = 'commit'`
    ];
    const values: Array<string | number> = [];
    let index = 1;

    if (params.sourceId) {
      values.push(params.sourceId);
      where.push(`a.source_id = $${index}`);
      index += 1;
    }

    if (params.branch) {
      values.push(params.branch);
      where.push(`COALESCE((v.data -> 'branches')::jsonb, '[]'::jsonb) ? $${index}`);
      index += 1;
    }

    if (params.query) {
      const like = `%${params.query}%`;
      values.push(like);
      where.push(
        `(
          a."displayName" ILIKE $${index}
          OR v.version ILIKE $${index}
          OR v.data ->> 'commitHash' ILIKE $${index}
          OR v.data ->> 'message' ILIKE $${index}
          OR v.data ->> 'author' ILIKE $${index}
          OR v.data ->> 'committer' ILIKE $${index}
          OR CAST(v.data -> 'changes' AS TEXT) ILIKE $${index}
        )`
      );
      index += 1;
    }

    const cursor = decodeCursor(params.cursor);
    if (cursor) {
      values.push(cursor.updatedAt, cursor.id);
      where.push(`(a."updatedAt", a.id) < ($${index}, $${index + 1})`);
      index += 2;
    }

    values.push(limit);

    const query = `
      SELECT
        a.id,
        a."displayName" AS display_name,
        a."pluginKey" AS plugin_key,
        a."externalId" AS external_id,
        s.id AS source_id,
        s."name" AS source_name,
        s."pluginKey" AS source_plugin_key,
        a.last_version_id,
        v.version,
        v.metadata AS version_metadata,
        v.data AS version_data,
        v."originalUrl" AS original_url,
        v.timestamp AS version_timestamp,
        v.checksum,
        v."createdAt" AS version_created_at,
        a."createdAt" AS created_at,
        a."updatedAt" AS updated_at
      FROM artifacts a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN artifact_versions v ON v.id = a.last_version_id
      WHERE ${where.join(' AND ')}
      ORDER BY a."updatedAt" DESC, a.id DESC
      LIMIT $${index}
    `;

    const { rows } = await this.pool.query<ArtifactSummaryRow>(query, values);
    const items = rows.map(mapGitCommitSummaryRow);

    if (items.length === limit && rows.length > 0) {
      const lastRow = rows[rows.length - 1]!;
      const nextCursor = encodeCursor({ updatedAt: lastRow.updated_at, id: lastRow.id });
      return { items, nextCursor };
    }

    return { items };
  }

  async findGitFilesByExternalIds(
    externalIds: string[]
  ): Promise<Map<string, GitFileArtifactSummary>> {
    if (!externalIds.length) {
      return new Map();
    }
    const query = `
      SELECT
        a.id AS artifact_id,
        a."externalId" AS external_id,
        a.source_id,
        v.data AS version_data
      FROM artifacts a
      JOIN artifact_versions v ON v.id = a.last_version_id
      WHERE a."externalId" = ANY($1)
        AND a."pluginKey" = 'git'
        AND v.data ->> 'artifactType' = 'file'
    `;

    const { rows } = await this.pool.query<GitFileRow>(query, [externalIds]);
    const map = new Map<string, GitFileArtifactSummary>();
    rows.forEach((row) => {
      const summary = mapGitFileRow(row);
      map.set(summary.externalId, summary);
    });
    return map;
  }

  async findGitFilesByCommitAndPaths(
    sourceId: string | null | undefined,
    commitHash: string,
    paths: string[]
  ): Promise<Map<string, GitFileArtifactSummary>> {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    if (!uniquePaths.length) {
      return new Map();
    }

    const values: Array<string | string[]> = [commitHash, uniquePaths];
    let index = 3;
    let sourceClause = '';
    if (sourceId) {
      values.push(sourceId);
      sourceClause = `AND a.source_id = $${index}`;
      index += 1;
    }

    const query = `
      SELECT
        a.id AS artifact_id,
        a."externalId" AS external_id,
        a.source_id,
        v.data AS version_data
      FROM artifacts a
      JOIN artifact_versions v ON v.id = a.last_version_id
      WHERE a."pluginKey" = 'git'
        AND v.data ->> 'artifactType' = 'file'
        AND v.data ->> 'commitHash' = $1
        AND v.data ->> 'path' = ANY($2)
        ${sourceClause}
    `;

    const { rows } = await this.pool.query<GitFileRow>(query, values);
    const map = new Map<string, GitFileArtifactSummary>();
    rows.forEach((row) => {
      const summary = mapGitFileRow(row);
      map.set(summary.path, summary);
    });
    return map;
  }

  async findGitCommitByHash(
    commitHash: string,
    sourceId?: string
  ): Promise<ArtifactSummary | null> {
    const values: Array<string> = [commitHash];
    let sourceClause = '';
    if (sourceId) {
      values.push(sourceId);
      sourceClause = 'AND a.source_id = $2';
    }

    const query = `
      SELECT
        a.id,
        a."displayName" AS display_name,
        a."pluginKey" AS plugin_key,
        a."externalId" AS external_id,
        s.id AS source_id,
        s."name" AS source_name,
        s."pluginKey" AS source_plugin_key,
        a.last_version_id,
        v.version,
        v.metadata AS version_metadata,
        v.data AS version_data,
        v."originalUrl" AS original_url,
        v.timestamp AS version_timestamp,
        v.checksum,
        v."createdAt" AS version_created_at,
        a."createdAt" AS created_at,
        a."updatedAt" AS updated_at
      FROM artifacts a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN artifact_versions v ON v.id = a.last_version_id
      WHERE a."pluginKey" = 'git'
        AND v.data ->> 'artifactType' = 'commit'
        AND (v.version = $1 OR v.data ->> 'commitHash' = $1)
        ${sourceClause}
      ORDER BY a."updatedAt" DESC
      LIMIT 1
    `;

    const { rows } = await this.pool.query<ArtifactSummaryRow>(query, values);
    const row = rows[0];
    return row ? mapArtifactSummaryRow(row) : null;
  }

  async findDocsArtifactByPath(sourceId: string, path: string): Promise<ArtifactSummary | null> {
    const query = `
      SELECT
        a.id,
        a."displayName" AS display_name,
        a."pluginKey" AS plugin_key,
        a."externalId" AS external_id,
        s.id AS source_id,
        s."name" AS source_name,
        s."pluginKey" AS source_plugin_key,
        a.last_version_id,
        v.version,
        v.metadata AS version_metadata,
        v.data AS version_data,
        v."originalUrl" AS original_url,
        v.timestamp AS version_timestamp,
        v.checksum,
        v."createdAt" AS version_created_at,
        a."createdAt" AS created_at,
        a."updatedAt" AS updated_at
      FROM artifacts a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN artifact_versions v ON v.id = a.last_version_id
      WHERE a."pluginKey" = 'docs'
        AND a.source_id = $1
        AND v.data ->> 'path' = $2
      ORDER BY a."updatedAt" DESC
      LIMIT 1
    `;

    const { rows } = await this.pool.query<ArtifactSummaryRow>(query, [sourceId, path]);
    const row = rows[0];
    return row ? mapArtifactSummaryRow(row) : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

const mapArtifactSummaryRow = (row: ArtifactSummaryRow): ArtifactSummary => {
  const lastVersion: ArtifactVersionSummary | null = row.last_version_id
    ? {
        id: row.last_version_id,
        version: row.version ?? '',
        metadata: row.version_metadata,
        data: row.version_data,
        originalUrl: row.original_url,
        timestamp: row.version_timestamp
          ? new Date(row.version_timestamp).toISOString()
          : null,
        checksum: row.checksum ?? undefined,
        createdAt: row.version_created_at
          ? new Date(row.version_created_at).toISOString()
          : undefined
      }
    : null;

  return {
    id: row.id,
    displayName: row.display_name,
    pluginKey: row.plugin_key,
    externalId: row.external_id,
    source: row.source_id
      ? {
          id: row.source_id,
          name: row.source_name ?? row.source_id,
          pluginKey: row.source_plugin_key ?? row.plugin_key
        }
      : null,
    lastVersion,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
};

const mapGitCommitSummaryRow = (row: ArtifactSummaryRow): GitCommitSummary => {
  const data = (row.version_data ?? {}) as Record<string, unknown>;
  const branches = ensureStringArray(data.branches);
  const parents = ensureStringArray(data.parents);
  const fileExternalIds = ensureStringArray(data.fileArtifacts);
  const author = buildPersonSummary(
    typeof data.author === 'string' ? data.author : undefined,
    typeof data.authorEmail === 'string' ? data.authorEmail : undefined,
    typeof data.authorDate === 'string' ? data.authorDate : undefined
  );
  const committer = buildPersonSummary(
    typeof data.committer === 'string' ? data.committer : undefined,
    typeof data.committerEmail === 'string' ? data.committerEmail : undefined,
    typeof data.committerDate === 'string' ? data.committerDate : undefined
  );
  const changes = mapCommitChanges(data.changes);
  const source = row.source_id
    ? {
        id: row.source_id,
        name: row.source_name ?? row.source_id
      }
    : null;

  const summary: GitCommitSummary = {
    artifactId: row.id,
    displayName: row.display_name,
    commitHash:
      typeof data.commitHash === 'string'
        ? data.commitHash
        : row.version ?? row.id,
    branches,
    parents,
    timestamp: row.version_timestamp
      ? new Date(row.version_timestamp).toISOString()
      : row.updated_at,
    source,
    fileExternalIds,
    changes
  };
  if (typeof data.message === 'string') {
    summary.message = data.message;
  }
  if (author) {
    summary.author = author;
  }
  if (committer) {
    summary.committer = committer;
  }
  return summary;
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
      const path = typeof change.path === 'string' ? change.path : undefined;
      if (!path) {
        return null;
      }
      const mapped: GitCommitChange = { path };
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

const mapGitFileRow = (row: GitFileRow): GitFileArtifactSummary => {
  const data = (row.version_data ?? {}) as Record<string, unknown>;
  const summary: GitFileArtifactSummary = {
    artifactId: row.artifact_id,
    externalId: row.external_id,
    path: typeof data.path === 'string' ? data.path : row.external_id,
    commitHash: typeof data.commitHash === 'string' ? data.commitHash : '',
    branches: ensureStringArray(data.branches)
  };
  if (row.source_id) {
    summary.sourceId = row.source_id;
  }
  if (typeof data.encoding === 'string') {
    summary.encoding = data.encoding;
  }
  if (typeof data.content === 'string') {
    summary.content = data.content;
  }
  if (typeof data.size === 'number') {
    summary.size = data.size;
  }
  return summary;
};

const buildPersonSummary = (
  name?: string,
  email?: string,
  date?: string
): GitCommitSummary['author'] => {
  const details: { name?: string; email?: string; date?: string } = {};
  if (name) {
    details.name = name;
  }
  if (email) {
    details.email = email;
  }
  if (date) {
    const normalized = new Date(date).toISOString();
    details.date = normalized;
  }
  return Object.keys(details).length ? details : undefined;
};
