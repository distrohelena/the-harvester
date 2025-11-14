import { Controller, Get } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service.js';

@Controller('plugins')
export class PluginsController {
  constructor(private readonly pluginRegistry: PluginRegistryService) {}

  @Get()
  getPlugins() {
    return this.pluginRegistry.listDescriptors();
  }
}
