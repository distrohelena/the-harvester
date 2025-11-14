import { Injectable } from '@nestjs/common';
import { SourcesService } from '../sources/sources.service.js';
import { PluginRegistryService } from '../plugins/plugin-registry.service.js';

@Injectable()
export class NavigationService {
  constructor(
    private readonly sourcesService: SourcesService,
    private readonly pluginRegistry: PluginRegistryService
  ) {}

  async buildNavigation(sourceId: string) {
    const source = await this.sourcesService.findOne(sourceId);
    const plugin = this.pluginRegistry.getPlugin(source.pluginKey);
    if (!plugin.buildNavigation) {
      return { nodes: [] };
    }
    return plugin.buildNavigation(sourceId);
  }
}
