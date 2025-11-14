import http from './http';
import type { SourceModel } from '../types/plugins';

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchSources(params?: Record<string, any>) {
  const { data } = await http.get<PaginatedResponse<SourceModel>>('/sources', { params });
  return data;
}

export async function fetchSource(id: string) {
  const { data } = await http.get<SourceModel>(`/sources/${id}`);
  return data;
}

export async function createSource(payload: Partial<SourceModel>) {
  const { data } = await http.post<SourceModel>('/sources', payload);
  return data;
}

export async function updateSource(id: string, payload: Partial<SourceModel>) {
  const { data } = await http.put<SourceModel>(`/sources/${id}`, payload);
  return data;
}

export async function deleteSource(id: string) {
  await http.delete(`/sources/${id}`);
}

export async function enqueueRun(id: string) {
  await http.post(`/sources/${id}/run`);
}
