import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArtifactEntity } from '../artifacts/artifact.entity.js';
import { PluginRegistryService } from './plugin-registry.service.js';
import { DocsPlugin } from './docs/docs.plugin.js';
import { ConfluencePlugin } from './confluence/confluence.plugin.js';
import { GitPlugin } from './git/git.plugin.js';
import { PlainWebsitePlugin } from './plain-website/plain-website.plugin.js';
import { JiraPlugin } from './jira/jira.plugin.js';
import { PluginsController } from './plugins.controller.js';
import { GitPluginController } from './git/git.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([ArtifactEntity])],
  providers: [
    PluginRegistryService,
    DocsPlugin,
    ConfluencePlugin,
    GitPlugin,
    PlainWebsitePlugin,
    JiraPlugin
  ],
  controllers: [PluginsController, GitPluginController],
  exports: [PluginRegistryService]
})
export class PluginModule {}
