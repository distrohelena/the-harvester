import http from './http';
import type { PaginatedResponse } from './sources';
import type { SourceModel } from '../types/plugins';

export interface ExtractionRunModel {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  createdArtifacts: number;
  updatedArtifacts: number;
  skippedArtifacts: number;
  source: SourceModel;
}

export async function fetchRuns(params?: Record<string, any>) {
  const { data } = await http.get<PaginatedResponse<ExtractionRunModel>>('/runs', { params });
  return data;
}

export async function fetchRun(id: string) {
  const { data } = await http.get<ExtractionRunModel>(`/runs/${id}`);
  return data;
}
