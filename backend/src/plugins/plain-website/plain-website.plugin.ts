import { Injectable, Logger } from '@nestjs/common';
import { Plugin, PluginNavigationPayload, NormalizedArtifact } from '../interfaces.js';
import { SourceEntity } from '../../sources/source.entity.js';

@Injectable()
export class PlainWebsitePlugin implements Plugin {
  private readonly logger = new Logger(PlainWebsitePlugin.name);

  readonly descriptor = {
    key: 'plain_website',
    name: 'Plain Website Scraper',
    optionsSchema: {
      fields: [
        { name: 'url', label: 'URL', type: 'string', required: true },
        { name: 'selector', label: 'CSS Selector', type: 'string' }
      ]
    },
    artifactSchema: {
      fields: [
        { name: 'url', label: 'URL', type: 'string', required: true },
        { name: 'html', label: 'HTML', type: 'string', required: true },
        { name: 'text', label: 'Text', type: 'string' }
      ]
    },
    navigationSchema: {
      type: 'list',
      label: 'Page List'
    }
  } as const;

  async extract(_source: SourceEntity): Promise<NormalizedArtifact[]> {
    this.logger.warn('PlainWebsitePlugin.extract invoked without implementation – returning empty result.');
    return [];
  }

  async buildNavigation(_sourceId: string): Promise<PluginNavigationPayload> {
    return { nodes: [] };
  }
}
