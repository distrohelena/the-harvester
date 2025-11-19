import { z } from 'zod';
import { formatArtifactSummary } from '../../formatters.js';
import type { ArtifactSummary } from '../../artifact-repository.js';
import type { McpServerPlugin, PluginContext } from '../types.js';

/**
 * The docs plugin exposes a single tool (docs-follow-link) that converts relative/absolute
 * hyperlinks from harvested documentation into internal artifact references.
 *
 * Harvested docs frequently include navigation links that should keep an agent inside
 * the indexed corpus. Rather than re-fetch the public site, we capture the current artifact,
 * resolve the href against the recorded version root + base path, and look up the matching artifact.
 *
 * The implementation mirrors the frontend's link resolution logic, so navigating via MCP
 * or the web UI behaves identically.
 */

const followLinkInputSchema = z.object({
  artifactId: z.string().min(1).describe('Artifact ID of the page containing the link.'),
  href: z
    .string()
    .min(1, { message: 'Provide the hyperlink to follow.' })
    .describe('Link href value (relative or absolute).')
});

const followLinkOutputSchema = z.object({
  artifactId: z.string().optional(),
  path: z.string().optional(),
  note: z.string().optional()
});

export const docsPlugin: McpServerPlugin = {
  key: 'docs',
  instructions:
    'Use docs-follow-link with the current documentation artifact ID and a hyperlink to jump directly to harvested pages instead of browsing externally.',
  register: (context) => {
    registerDocsFollowLinkTool(context);
  }
};

const registerDocsFollowLinkTool = ({ server, repository }: PluginContext) => {
  server.registerTool(
    'docs-follow-link',
    {
      title: 'Follow docs link',
      description: 'Resolve internal documentation links to harvested artifacts.',
      inputSchema: followLinkInputSchema,
      outputSchema: followLinkOutputSchema
    },
    async ({ artifactId, href }) => {
      const artifact = await repository.getArtifactById(artifactId);
      if (!artifact || artifact.pluginKey !== 'docs') {
        return formatFollowLinkResult(`Artifact ${artifactId} is not a documentation page.`);
      }
      if (!artifact.lastVersion) {
        return formatFollowLinkResult('Artifact has no recorded versions to inspect.');
      }
      if (!artifact.source?.id) {
        return formatFollowLinkResult('Artifact source is unavailable; cannot resolve links.');
      }
      const normalizedPath = resolveDocsHref(artifact, href);
      if (!normalizedPath) {
        return formatFollowLinkResult('The provided link does not resolve to another harvested page.');
      }
      const target = await repository.findDocsArtifactByPath(artifact.source.id, normalizedPath);
      if (!target) {
        return formatFollowLinkResult(
          `No harvested artifact was found for path ${normalizedPath}.`,
          normalizedPath
        );
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Link resolved to artifact ${target.id} (${target.displayName}).\n\n${formatArtifactSummary(
              target
            )}`
          }
        ],
        structuredContent: followLinkOutputSchema.parse({
          artifactId: target.id,
          path: normalizedPath
        })
      };
    }
  );
};

const formatFollowLinkResult = (note: string, path?: string) => {
  return {
    content: [
      {
        type: 'text' as const,
        text: note
      }
    ],
    structuredContent: followLinkOutputSchema.parse(
      path
        ? {
            note,
            path
          }
        : { note }
    )
  };
};

/**
 * Resolves a hyperlink from a documentation artifact into the internal harvested path.
 * Returns null when the link is an external origin, an anchor, or otherwise unresolvable.
 */
export const resolveDocsHref = (artifact: ArtifactSummary, href: string): string | null => {
  if (!artifact.lastVersion || !href || href.startsWith('#')) {
    return null;
  }

  const metadata = (artifact.lastVersion.metadata ?? {}) as Record<string, unknown>;
  const baseUrl = deriveBaseUrl(artifact, metadata);
  if (!baseUrl) {
    return null;
  }

  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return null;
  }

  const allowedOrigins = buildAllowedOrigins(artifact, metadata);
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(resolved.origin)) {
    return null;
  }

  const basePath = determineBasePath(metadata);
  return extractRelativePath(resolved, basePath);
};

const deriveBaseUrl = (
  artifact: ArtifactSummary,
  metadata: Record<string, unknown>
): URL | null => {
  const candidate =
    typeof artifact.lastVersion?.originalUrl === 'string'
      ? artifact.lastVersion.originalUrl
      : typeof metadata.versionRoot === 'string'
        ? metadata.versionRoot
        : undefined;
  if (!candidate) {
    return null;
  }
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
};

const buildAllowedOrigins = (
  artifact: ArtifactSummary,
  metadata: Record<string, unknown>
): string[] => {
  const origins = new Set<string>();
  if (typeof artifact.lastVersion?.originalUrl === 'string') {
    const parsed = safeParseUrl(artifact.lastVersion.originalUrl);
    if (parsed) {
      origins.add(parsed.origin);
    }
  }
  if (typeof metadata.versionRoot === 'string') {
    const parsed = safeParseUrl(metadata.versionRoot);
    if (parsed) {
      origins.add(parsed.origin);
    }
  }
  if (origins.size === 0) {
    return [];
  }
  return Array.from(origins.values());
};

const determineBasePath = (metadata: Record<string, unknown>): string => {
  const raw =
    typeof metadata.versionBasePath === 'string'
      ? metadata.versionBasePath
      : typeof metadata.versionRoot === 'string'
        ? safeParseUrl(metadata.versionRoot)?.pathname
        : undefined;
  return normalizeBasePath(raw);
};

const extractRelativePath = (url: URL, basePath: string): string | null => {
  const normalizedBase = normalizeBasePath(basePath);
  if (normalizedBase === '/') {
    return normalizeDocPath(url.pathname);
  }

  const baseNoTrailing = normalizedBase.slice(0, -1);
  if (url.pathname === baseNoTrailing) {
    return '/';
  }
  if (!url.pathname.startsWith(normalizedBase)) {
    return null;
  }
  const remainder = url.pathname.slice(normalizedBase.length);
  return normalizeDocPath(remainder ? `/${remainder}` : '/');
};

const normalizeBasePath = (value?: string | null): string => {
  if (!value || value === '/') {
    return '/';
  }
  let path = value.trim();
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  if (!path.endsWith('/')) {
    path = `${path}/`;
  }
  return path;
};

const normalizeDocPath = (value?: string | null): string => {
  if (!value) {
    return '/';
  }
  let cleaned = value.trim();
  if (!cleaned.startsWith('/')) {
    cleaned = `/${cleaned}`;
  }
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned || '/';
};

const safeParseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};
