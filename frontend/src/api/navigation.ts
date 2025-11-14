import http from './http';

export interface NavigationNode {
  id?: string;
  label: string;
  children?: NavigationNode[];
  data?: Record<string, any>;
}

export interface NavigationPayload {
  nodes: NavigationNode[];
}

export async function fetchNavigation(sourceId: string) {
  const { data } = await http.get<NavigationPayload>(`/sources/${sourceId}/navigation`);
  return data;
}
