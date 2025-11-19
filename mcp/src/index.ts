import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { config } from './config.js';
import { ArtifactRepository } from './artifact-repository.js';
import type { ArtifactSummary, SearchArtifactsParams } from './artifact-repository.js';
import { formatArtifactSummary, formatSourceSummary } from './formatters.js';
import { registerPlugins } from './plugins/index.js';
import { buildServerInstructions } from './server-instructions.js';

const repository = new ArtifactRepository(config.databaseUrl);

const artifactSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  pluginKey: z.string(),
  externalId: z.string(),
  source: z
    .object({
      id: z.string(),
      name: z.string(),
      pluginKey: z.string()
    })
    .nullable()
    .optional(),
  lastVersion: z
    .object({
      id: z.string(),
      version: z.string().optional(),
      metadata: z.unknown().optional(),
      data: z.unknown().optional(),
      originalUrl: z.string().nullable().optional(),
      timestamp: z.string().nullable().optional(),
      checksum: z.string().nullable().optional(),
      createdAt: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const searchInputSchema = z.object({
  query: z
    .string()
    .min(1, { message: 'Provide a search query (artifact name, metadata, etc.)' })
    .optional()
    .describe(
      'Free-form text to locate artifacts. Optional: omit it to browse the most recently updated artifacts.'
    ),
  pluginKey: z
    .string()
    .optional()
    .describe('Restrict the search to a specific plugin or project type.'),
  sourceId: z.string().optional().describe('Restrict results to a specific source/project.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(config.maxSearchResults)
    .optional()
    .describe('Maximum results to return.'),
  cursor: z
    .string()
    .optional()
    .describe('Cursor returned from a previous search to continue pagination.')
});

const searchOutputSchema = z.object({
  items: z.array(artifactSchema),
  nextCursor: z.string().optional()
});

const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  pluginKey: z.string(),
  artifactCount: z.number()
});

const listSourcesOutputSchema = z.object({
  items: z.array(sourceSchema)
});

const createServer = () => {
  const server = new McpServer(
    {
      name: 'artifact-harvester-mcp',
      version: packageJson.version ?? '0.0.0'
    },
    {
      instructions: buildServerInstructions()
    }
  );

  registerListSourcesTool(server);
  registerSearchTool(server);
  registerArtifactResource(server);
  registerPlugins({ server, repository, config });

  return server;
};

const registerSearchTool = (server: McpServer) => {
  server.registerTool(
    'search-artifacts',
    {
      title: 'Search harvested artifacts',
      description:
        'Find harvested artifacts by name, plugin key, project, or JSON metadata. Supports pagination via cursor.',
      inputSchema: searchInputSchema,
      outputSchema: searchOutputSchema
    },
    async (args) => {
      const normalizedQuery =
        typeof args.query === 'string' && args.query.trim().length > 0 ? args.query : undefined;
      const params: SearchArtifactsParams = {
        query: normalizedQuery,
        pluginKey: args.pluginKey,
        sourceId: args.sourceId,
        limit: args.limit ?? config.maxSearchResults,
        cursor: args.cursor
      };

      const result = await repository.searchArtifacts(params);
      const text = result.items.length
        ? result.items.map((artifact) => formatArtifactSummary(artifact)).join('\n\n---\n\n')
        : 'No artifacts matched the query.';

      return {
        content: [
          {
            type: 'text' as const,
            text
          }
        ],
        structuredContent: result as unknown as Record<string, unknown>
      };
    }
  );
};

const registerListSourcesTool = (server: McpServer) => {
  server.registerTool(
    'list-sources',
    {
      title: 'List available sources',
      description:
        'Enumerate every configured source/project with plugin keys, activity flags, and artifact counts.',
      outputSchema: listSourcesOutputSchema
    },
    async () => {
      const items = await repository.listSources();
      const text = items.length
        ? items.map((source) => formatSourceSummary(source)).join('\n\n---\n\n')
        : 'No sources have been configured yet.';

      return {
        content: [
          {
            type: 'text' as const,
            text
          }
        ],
        structuredContent: { items } as unknown as Record<string, unknown>
      };
    }
  );
};

const registerArtifactResource = (server: McpServer) => {
  server.registerResource(
    'artifact-detail',
    new ResourceTemplate('artifact://{artifactId}', {
      list: async () => {
        const artifacts = await repository.listRecentArtifacts(config.resourceSampleSize);
        return {
          resources: artifacts.map((artifact) => mapArtifactToResource(artifact))
        };
      },
      complete: {
        artifactId: async (value: string) => repository.completeArtifactId(value, 8)
      }
    }),
    {
      title: 'Artifact detail',
      description: 'Latest stored data for a specific artifact.',
      mimeType: 'text/plain'
    },
    async (uri, variables) => {
      const raw = variables['artifactId'];
      const artifactId =
        typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
      if (!artifactId) {
        throw new Error('Artifact ID missing in URI.');
      }

      const artifact = await repository.getArtifactById(artifactId);
      if (!artifact) {
        throw new Error(`Artifact ${artifactId} not found.`);
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: formatArtifactSummary(artifact)
          }
        ]
      };
    }
  );
};

const mapArtifactToResource = (artifact: ArtifactSummary) => ({
  uri: `artifact://${artifact.id}`,
  name: artifact.displayName,
  description: artifact.source
    ? `Source ${artifact.source.name} - Plugin ${artifact.pluginKey}`
    : `Plugin ${artifact.pluginKey}`,
  mimeType: 'text/plain'
});

const startStdioServer = async () => {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Artifact MCP server ready (stdio transport).');

  const shutdown = async () => {
    await server.close().catch(() => undefined);
    await repository.close().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

const startHttpServer = async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    const requestedHeaders =
      req.header('Access-Control-Request-Headers') ?? 'content-type,mcp-session-id';
    res.header('Access-Control-Allow-Headers', requestedHeaders);
    res.header('Access-Control-Expose-Headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const healthPath = config.httpPath.endsWith('/') ? `${config.httpPath}health` : `${config.httpPath}/health`;
  app.get(healthPath, (_req, res) => {
    res.json({
      status: 'ready',
      transport: 'streamable-http',
      endpoint: config.httpPath,
      version: packageJson.version ?? '0.0.0',
      instructions: 'Send POST requests with a Model Context Protocol payload.'
    });
  });

  type SessionContext = {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
  };

  const sessions = new Map<string, SessionContext>();

  const closeContext = async (context: SessionContext) => {
    await context.transport.close().catch(() => undefined);
    await context.server.close().catch(() => undefined);
  };

  const removeSession = async (sessionId?: string) => {
    if (!sessionId) {
      return;
    }
    const context = sessions.get(sessionId);
    if (!context) {
      return;
    }
    sessions.delete(sessionId);
    await closeContext(context);
  };

  const createSessionContext = async () => {
    const server = createServer();
    let context: SessionContext;
    const transportOptions: ConstructorParameters<typeof StreamableHTTPServerTransport>[0] = {
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      enableDnsRebindingProtection: config.httpEnableDnsProtection,
      onsessioninitialized: (sessionId: string) => {
        sessions.set(sessionId, context);
      },
      onsessionclosed: async (sessionId?: string) => {
        await removeSession(sessionId);
      }
    };

    if (config.httpAllowedHosts.length) {
      transportOptions.allowedHosts = config.httpAllowedHosts;
    }
    if (config.httpAllowedOrigins.length) {
      transportOptions.allowedOrigins = config.httpAllowedOrigins;
    }

    const transport = new StreamableHTTPServerTransport(transportOptions);
    context = { server, transport };
    await server.connect(transport);
    return context;
  };

  const closeAllSessions = async () => {
    const active = Array.from(sessions.values());
    sessions.clear();
    await Promise.all(active.map((session) => closeContext(session)));
  };

  const getSessionIdFromHeader = (value: string | string[] | undefined) => {
    if (Array.isArray(value)) {
      return value[value.length - 1];
    }
    return typeof value === 'string' ? value : undefined;
  };

  const isInitializationPayload = (payload: unknown) => {
    if (Array.isArray(payload)) {
      return payload.length === 1 && isInitializeRequest(payload[0]);
    }
    return isInitializeRequest(payload);
  };

  const handleExistingSessionRequest = async (
    sessionId: string,
    handler: (context: SessionContext) => Promise<void>,
    res: express.Response
  ) => {
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      await handler(session);
    } catch (error) {
      console.error('MCP HTTP request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
      await removeSession(sessionId);
    }
  };

  app.post(config.httpPath, async (req, res) => {
    const sessionId = getSessionIdFromHeader(req.headers['mcp-session-id']);
    if (sessionId) {
      await handleExistingSessionRequest(
        sessionId,
        async (session) => {
          await session.transport.handleRequest(req, res, req.body);
        },
        res
      );
      return;
    }

    if (!isInitializationPayload(req.body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: Initialization required before issuing further requests'
        },
        id: null
      });
      return;
    }

    const context = await createSessionContext();
    try {
      await context.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP HTTP request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
      if (context.transport.sessionId) {
        await removeSession(context.transport.sessionId);
      } else {
        await closeContext(context);
      }
    }
  });

  const requireSession = (req: express.Request, res: express.Response) => {
    const sessionId = getSessionIdFromHeader(req.headers['mcp-session-id']);
    if (!sessionId) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: Mcp-Session-Id header is required'
        },
        id: null
      });
      return undefined;
    }
    return sessionId;
  };

  app.get(config.httpPath, async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) {
      return;
    }
    await handleExistingSessionRequest(
      sessionId,
      async (session) => {
        await session.transport.handleRequest(req, res);
      },
      res
    );
  });

  app.delete(config.httpPath, async (req, res) => {
    const sessionId = requireSession(req, res);
    if (!sessionId) {
      return;
    }
    await handleExistingSessionRequest(
      sessionId,
      async (session) => {
        await session.transport.handleRequest(req, res);
      },
      res
    );
  });

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const listener = app
      .listen(config.httpPort, config.httpHost, () => {
        console.error(
          `Artifact MCP server ready (HTTP) at http://${config.httpHost}:${config.httpPort}${config.httpPath}`
        );
        resolve(listener);
      })
      .on('error', reject);
  });

  const shutdown = async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closeAllSessions();
    await repository.close().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

const bootstrap = async () => {
  if (config.transport === 'stdio') {
    await startStdioServer();
  } else {
    await startHttpServer();
  }
};

bootstrap().catch(async (error) => {
  console.error('Failed to start Artifact MCP server:', error);
  await repository.close().catch(() => undefined);
  process.exit(1);
});
