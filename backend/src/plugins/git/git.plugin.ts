import { Injectable, Logger } from '@nestjs/common';
import { Plugin, PluginNavigationPayload, NormalizedArtifact } from '../interfaces.js';
import { SourceEntity } from '../../sources/source.entity.js';

@Injectable()
export class GitPlugin implements Plugin {
  private readonly logger = new Logger(GitPlugin.name);

  readonly descriptor = {
    key: 'git',
    name: 'Git Commit Extractor',
    optionsSchema: {
      fields: [
        { name: 'repoUrl', label: 'Repository URL', type: 'string', required: true },
        { name: 'branch', label: 'Branch', type: 'string', required: true },
        {
          name: 'authToken',
          label: 'Auth Token',
          type: 'string',
          description: 'Optional token for private repositories'
        }
      ]
    },
    artifactSchema: {
      fields: [
        { name: 'commitHash', label: 'Commit Hash', type: 'string', required: true },
        { name: 'author', label: 'Author', type: 'string', required: true },
        { name: 'message', label: 'Message', type: 'string', required: true },
        { name: 'files', label: 'Changed Files', type: 'array' }
      ]
    },
    navigationSchema: {
      type: 'timeline',
      label: 'Commit History',
      description: 'Timeline of commits grouped by date'
    }
  } as const;

  async extract(_source: SourceEntity): Promise<NormalizedArtifact[]> {
    this.logger.warn('GitPlugin.extract invoked without implementation – returning empty result.');
    return [];
  }

  async buildNavigation(_sourceId: string): Promise<PluginNavigationPayload> {
    return { nodes: [] };
  }
}
