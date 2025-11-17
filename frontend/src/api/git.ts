import http from './http';
import type { PaginatedResponse } from './sources';
import type { ArtifactModel } from '../types/plugins';

export async function fetchGitCommits(sourceId: string, page = 1, limit = 25) {
  const { data } = await http.get<PaginatedResponse<ArtifactModel>>(
    `/plugins/git/sources/${sourceId}/commits`,
    { params: { page, limit } }
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
