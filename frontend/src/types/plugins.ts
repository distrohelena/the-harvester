export type PluginSchemaFieldType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';

export interface PluginSchemaField {
  name: string;
  label: string;
  type: PluginSchemaFieldType;
  required?: boolean;
  enumValues?: string[];
  description?: string;
}

export interface PluginSchema {
  fields: PluginSchemaField[];
}

export interface PluginNavigationSchema {
  type: 'tree' | 'list' | 'timeline';
  label: string;
  description?: string;
}

export interface PluginDescriptor {
  key: string;
  name: string;
  optionsSchema: PluginSchema;
  artifactSchema: PluginSchema;
  navigationSchema?: PluginNavigationSchema;
}

export interface SourceModel {
  id: string;
  name: string;
  pluginKey: string;
  options: Record<string, any>;
  scheduleCron?: string;
  isActive: boolean;
}

export interface ArtifactModel {
  id: string;
  displayName: string;
  pluginKey: string;
  source: SourceModel;
  lastVersion?: ArtifactVersionModel;
}

export interface ArtifactVersionModel {
  id: string;
  version: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
  checksum: string;
  originalUrl?: string;
  timestamp?: string;
  createdAt: string;
}
