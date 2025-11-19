import { buildPluginInstructions } from './plugins/index.js';

export const BASE_INSTRUCTIONS =
  'Use list-sources to discover available projects, search-artifacts to filter them, and artifact://{artifactId} to inspect details.';

export const buildServerInstructions = () => {
  const pluginInstructions = buildPluginInstructions();
  return pluginInstructions ? `${BASE_INSTRUCTIONS} ${pluginInstructions}` : BASE_INSTRUCTIONS;
};
