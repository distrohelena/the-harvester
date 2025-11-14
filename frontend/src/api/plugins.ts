import http from './http';
import type { PluginDescriptor } from '../types/plugins';

export async function fetchPlugins() {
  const { data } = await http.get<PluginDescriptor[]>('/plugins');
  return data;
}
