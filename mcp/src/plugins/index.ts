import type { PluginContext, McpServerPlugin } from './types.js';
import { gitPlugin } from '../git-tools.js';

const plugins: McpServerPlugin[] = [gitPlugin];

export const buildPluginInstructions = () =>
  plugins
    .map((plugin) => plugin.instructions?.trim())
    .filter((value): value is string => Boolean(value && value.length))
    .join(' ');

export const registerPlugins = (context: PluginContext) => {
  for (const plugin of plugins) {
    plugin.register(context);
  }
};
