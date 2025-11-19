import test from 'node:test';
import assert from 'node:assert/strict';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitPlugin } from '../src/plugins/git/index.js';
import type { AppConfig } from '../src/config.js';
import type {
  ArtifactRepository,
  GitFileArtifactSummary,
  GitCommitSummary,
  GitCommitSearchResult
} from '../src/artifact-repository.js';

type RegisteredTool = {
  definition: {
    outputSchema: { parse: (value: unknown) => unknown };
  };
  handler: (args: unknown) => Promise<{ structuredContent: any }>;
};

const createServerStub = () => {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: (name: string, definition: RegisteredTool['definition'], handler: RegisteredTool['handler']) => {
      tools.set(name, { definition, handler });
    }
  } as unknown as McpServer;
  return { server, tools };
};

const buildRepositoryStub = () => {
  const commit: GitCommitSummary = {
    artifactId: 'artifact-1',
    displayName: 'Add README',
    commitHash: 'abc123',
    message: 'docs: add README',
    branches: ['main'],
    parents: [],
    timestamp: '2024-01-01T00:00:00.000Z',
    source: { id: 'src-1', name: 'Repo' },
    fileExternalIds: ['file-ext-1'],
    changes: [
      {
        path: 'README.md',
        status: 'M',
        blobSha: 'sha',
        previousBlobSha: 'prev',
        size: 42,
        mode: '100644',
        previousMode: '100644'
      }
    ]
  };

  const fileSummary: GitFileArtifactSummary = {
    artifactId: 'artifact-file-1',
    externalId: 'file-ext-1',
    path: 'README.md',
    commitHash: 'abc123'
  };

  const repository = {
    searchGitCommits: async () =>
      ({
        items: [commit],
        nextCursor: 'cursor-1'
      }) as GitCommitSearchResult,
    findGitFilesByExternalIds: async () => new Map([[fileSummary.externalId, fileSummary]])
  } as unknown as ArtifactRepository;

  return repository;
};

const configStub: AppConfig = {
  databaseUrl: 'postgres://example',
  maxSearchResults: 10,
  resourceSampleSize: 5,
  transport: 'http',
  httpPort: 3333,
  httpHost: '0.0.0.0',
  httpPath: '/mcp',
  httpAllowedOrigins: [],
  httpAllowedHosts: [],
  httpEnableDnsProtection: true
};

test('git-search-commits structured output matches schema', async () => {
  const { server, tools } = createServerStub();
  const repository = buildRepositoryStub();

  gitPlugin.register({ server, repository, config: configStub });

  const tool = tools.get('git-search-commits');
  assert.ok(tool, 'git-search-commits tool should be registered');

  const response = await tool.handler({ limit: 1 });
  const structured = response.structuredContent;
  tool.definition.outputSchema.parse(structured);

  assert.equal(Array.isArray(structured.items), true, 'items should be an array');
  assert.equal('changes' in structured.items[0], false, 'internal change list should not be exposed');
  assert.equal(structured.items[0].files[0].path, 'README.md');
});
