import { Module } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service.js';
import { DocsPlugin } from './docs/docs.plugin.js';
import { GitPlugin } from './git/git.plugin.js';
import { PlainWebsitePlugin } from './plain-website/plain-website.plugin.js';
import { PluginsController } from './plugins.controller.js';

@Module({
  providers: [PluginRegistryService, DocsPlugin, GitPlugin, PlainWebsitePlugin],
  controllers: [PluginsController],
  exports: [PluginRegistryService]
})
export class PluginModule {}
