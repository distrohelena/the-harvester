import { Injectable, NotFoundException } from '@nestjs/common';
import { Plugin, PluginDescriptor } from './interfaces.js';
import { DocsPlugin } from './docs/docs.plugin.js';
import { ConfluencePlugin } from './confluence/confluence.plugin.js';
import { GitPlugin } from './git/git.plugin.js';
import { PlainWebsitePlugin } from './plain-website/plain-website.plugin.js';
import { JiraPlugin } from './jira/jira.plugin.js';

@Injectable()
export class PluginRegistryService {
  private readonly registry = new Map<string, Plugin>();

  constructor(
    docsPlugin: DocsPlugin,
    confluencePlugin: ConfluencePlugin,
    gitPlugin: GitPlugin,
    plainWebsitePlugin: PlainWebsitePlugin,
    jiraPlugin: JiraPlugin
  ) {
    [docsPlugin, confluencePlugin, gitPlugin, plainWebsitePlugin, jiraPlugin].forEach((plugin) =>
      this.registry.set(plugin.descriptor.key, plugin)
    );
  }

  listDescriptors(): PluginDescriptor[] {
    return Array.from(this.registry.values()).map((plugin) => plugin.descriptor);
  }

  getPlugin(key: string): Plugin {
    const plugin = this.registry.get(key);
    if (!plugin) {
      throw new NotFoundException(`Plugin ${key} is not registered`);
    }
    return plugin;
  }
}
