import http from './http';
import type { PaginatedResponse } from './sources';
import type { ArtifactModel } from '../types/plugins';

export type GitCommitSort = 'newest' | 'oldest' | 'author' | 'message';

export interface GitSnapshotEntry {
  path: string;
  mode?: string;
  size?: number;
  blobSha?: string;
  externalId: string;
  sourceCommitHash?: string;
}

export interface GitSnapshotFileResponse extends GitSnapshotEntry {
  encoding: 'utf8' | 'base64';
  content: string;
}

export interface FetchGitCommitsOptions {
  search?: string;
  sort?: GitCommitSort;
}

export async function fetchGitCommits(
  sourceId: string,
  page = 1,
  limit = 25,
  options: FetchGitCommitsOptions = {}
) {
  const { search, sort } = options;
  const trimmedSearch = search?.trim();
  const params: Record<string, string | number | undefined> = {
    page,
    limit,
    sort
  };
  if (trimmedSearch) {
    params.search = trimmedSearch;
  }
  const { data } = await http.get<PaginatedResponse<ArtifactModel>>(
    `/plugins/git/sources/${sourceId}/commits`,
    { params }
  );
  return data;
}

export async function fetchGitFiles(sourceId: string, commitHash: string, limit = 500) {
  const { data } = await http.get<PaginatedResponse<ArtifactModel>>(
    `/plugins/git/sources/${sourceId}/commits/${commitHash}/files`,
    { params: { limit } }
  );
  return data;
}

export async function fetchGitCommitSnapshot(sourceId: string, commitHash: string, limit?: number) {
  const { data } = await http.get<{ items: GitSnapshotEntry[]; total: number }>(
    `/plugins/git/sources/${sourceId}/commits/${commitHash}/snapshot`,
    { params: { limit } }
  );
  return data;
}

export async function fetchGitCommitSnapshotFile(sourceId: string, commitHash: string, path: string) {
  const { data } = await http.get<GitSnapshotFileResponse>(
    `/plugins/git/sources/${sourceId}/commits/${commitHash}/blob`,
    { params: { path } }
  );
  return data;
}
