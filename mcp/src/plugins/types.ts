import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ArtifactRepository } from '../artifact-repository.js';
import type { AppConfig } from '../config.js';

export interface PluginContext {
  server: McpServer;
  repository: ArtifactRepository;
  config: AppConfig;
}

export interface McpServerPlugin {
  key: string;
  instructions?: string;
  register(context: PluginContext): void;
}
