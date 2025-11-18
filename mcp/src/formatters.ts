import type { ArtifactSummary, SourceSummary } from './artifact-repository.js';

const stringify = (value: unknown, max = 1200) => {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length <= max ? text : `${text.slice(0, max)}...`;
};

export const formatArtifactSummary = (artifact: ArtifactSummary): string => {
  const lines = [
    `Artifact: ${artifact.displayName} (${artifact.id})`,
    `Plugin: ${artifact.pluginKey}`,
    `External ID: ${artifact.externalId}`,
    `Source: ${artifact.source ? `${artifact.source.name} (${artifact.source.id})` : 'none'}`,
    `Updated at: ${artifact.updatedAt}`,
    `Created at: ${artifact.createdAt}`
  ];

  if (artifact.lastVersion) {
    lines.push(
      `Latest version: ${artifact.lastVersion.version || artifact.lastVersion.id}`,
      artifact.lastVersion.timestamp ? `Version timestamp: ${artifact.lastVersion.timestamp}` : '',
      artifact.lastVersion.originalUrl ? `Original URL: ${artifact.lastVersion.originalUrl}` : '',
      artifact.lastVersion.checksum ? `Checksum: ${artifact.lastVersion.checksum}` : ''
    );

    if (artifact.lastVersion.metadata) {
      lines.push('Metadata:', stringify(artifact.lastVersion.metadata));
    }
    if (artifact.lastVersion.data) {
      lines.push('Data:', stringify(artifact.lastVersion.data));
    }
  }

  return lines.filter(Boolean).join('\n');
};

export const formatSourceSummary = (source: SourceSummary): string => {
  return [
    `Source: ${source.name} (${source.id})`,
    `Plugin: ${source.pluginKey}`,
    `Artifacts tracked: ${source.artifactCount}`
  ].join('\n');
};
