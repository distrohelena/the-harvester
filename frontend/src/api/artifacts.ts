import http from './http';
import type { ArtifactModel, ArtifactVersionModel } from '../types/plugins';
import type { PaginatedResponse } from './sources';

export async function fetchArtifacts(params?: Record<string, any>) {
  const { data } = await http.get<PaginatedResponse<ArtifactModel>>('/artifacts', { params });
  return data;
}

export async function fetchArtifact(id: string) {
  const { data } = await http.get<ArtifactModel>(`/artifacts/${id}`);
  return data;
}

export async function fetchArtifactVersions(id: string) {
  const { data } = await http.get<ArtifactVersionModel[]>(`/artifacts/${id}/versions`);
  return data;
}

export async function fetchArtifactVersion(id: string) {
  const { data } = await http.get<ArtifactVersionModel>(`/artifact-versions/${id}`);
  return data;
}
