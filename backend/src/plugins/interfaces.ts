import { SourceEntity } from '../sources/source.entity.js';

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
  fields: ReadonlyArray<PluginSchemaField>;
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

export interface NormalizedArtifact {
  externalId: string;
  displayName: string;
  version: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
  originalUrl?: string;
  timestamp?: string;
}

export interface PluginNavigationPayload {
  nodes: Array<Record<string, any>>;
}

export interface PluginExtractContext {
  emitBatch?: (artifacts: NormalizedArtifact[]) => Promise<void>;
}

export interface Plugin {
  descriptor: PluginDescriptor;
  extract(source: SourceEntity, context?: PluginExtractContext): Promise<NormalizedArtifact[] | void>;
  buildNavigation?(sourceId: string): Promise<PluginNavigationPayload>;
}
