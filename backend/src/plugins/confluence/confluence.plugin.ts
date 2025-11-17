import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import {
  Plugin,
  PluginNavigationPayload,
  NormalizedArtifact,
  PluginExtractContext
} from '../interfaces.js';
import { SourceEntity } from '../../sources/source.entity.js';

interface ConfluencePluginOptions {
  baseUrl: string;
  userEmail?: string;
  apiToken?: string;
  personalAccessToken?: string;
  spaceKey?: string;
  spaceKeys?: string[];
  labelFilters?: string[];
  cql?: string;
  rootPageId?: string;
  includeArchived?: boolean;
  maxPages?: number;
}

interface NormalizedConfluenceOptions {
  baseUrl: string;
  authHeader?: string;
  searchCql: string;
  maxPages: number;
  includeArchived: boolean;
  spaceKeys: string[];
  labelFilters: string[];
  rootPageId?: string;
}

interface ConfluenceSearchResponse {
  results: ConfluenceContent[];
  start?: number;
  limit?: number;
  _links?: {
    next?: string;
    base?: string;
    context?: string;
  };
}

interface ConfluenceContent {
  id: string;
  title: string;
  type: string;
  status: string;
  version?: {
    number: number;
    when?: string;
    by?: {
      displayName?: string;
    };
  };
  body?: {
    storage?: {
      value?: string;
    };
  };
  space?: {
    key?: string;
    name?: string;
  };
  metadata?: {
    labels?: {
      results?: Array<{
        name?: string;
      }>;
    };
  };
  _links?: {
    webui?: string;
    tinyui?: string;
    self?: string;
    base?: string;
  };
}

@Injectable()
export class ConfluencePlugin implements Plugin {
  private readonly logger = new Logger(ConfluencePlugin.name);

  readonly descriptor = {
    key: 'confluence',
    name: 'Confluence',
    optionsSchema: {
      fields: [
        { name: 'baseUrl', label: 'Base URL', type: 'string', required: true },
        {
          name: 'userEmail',
          label: 'User Email',
          type: 'string',
          description: 'Required when using email + API token authentication'
        },
        {
          name: 'apiToken',
          label: 'API Token',
          type: 'string',
          description: 'API token for Confluence Cloud (paired with User Email)'
        },
        {
          name: 'personalAccessToken',
          label: 'Personal Access Token',
          type: 'string',
          description: 'Alternative bearer token for Confluence Data Center / Server'
        },
        {
          name: 'spaceKeys',
          label: 'Space Keys (one per line)',
          type: 'array',
          description: 'Restrict the crawl to these spaces'
        },
        {
          name: 'labelFilters',
          label: 'Label Filters (one per line)',
          type: 'array',
          description: 'Only fetch pages containing any of these labels'
        },
        {
          name: 'rootPageId',
          label: 'Root Page ID',
          type: 'string',
          description: 'Only fetch descendants of this page ID'
        },
        {
          name: 'cql',
          label: 'Custom CQL',
          type: 'string',
          description:
            'Override the generated CQL query entirely. Useful for advanced filtering.'
        },
        {
          name: 'includeArchived',
          label: 'Include Archived Pages',
          type: 'boolean'
        },
        {
          name: 'maxPages',
          label: 'Max Pages',
          type: 'number',
          description: 'Stops crawling after this many pages (default: 200)'
        }
      ]
    },
    artifactSchema: {
      fields: [
        { name: 'id', label: 'Page ID', type: 'string', required: true },
        { name: 'title', label: 'Title', type: 'string', required: true },
        { name: 'spaceKey', label: 'Space Key', type: 'string' },
        { name: 'html', label: 'HTML', type: 'string', required: true },
        { name: 'text', label: 'Text', type: 'string', required: true },
        { name: 'version', label: 'Version Number', type: 'number' },
        { name: 'labels', label: 'Labels', type: 'array' },
        { name: 'url', label: 'Page URL', type: 'string' }
      ]
    },
    navigationSchema: {
      type: 'list',
      label: 'Confluence Pages'
    }
  } as const;

  async extract(
    source: SourceEntity,
    context?: PluginExtractContext
  ): Promise<NormalizedArtifact[] | void> {
    const options = this.normalizeOptions(source.options as ConfluencePluginOptions);
    const http = this.createHttpClient(options);

    this.logger.log(
      `ConfluencePlugin crawling ${options.baseUrl} (space filters: ${
        options.spaceKeys.length ? options.spaceKeys.join(', ') : 'ALL'
      })`
    );

    const collected: NormalizedArtifact[] = [];
    const emitBatch = async (batch: NormalizedArtifact[]) => {
      if (!batch.length) {
        return;
      }
      if (context?.emitBatch) {
        await context.emitBatch(batch);
      } else {
        collected.push(...batch);
      }
    };

    const pageSize = 25;
    let start = 0;
    let processed = 0;

    while (processed < options.maxPages) {
      const remaining = options.maxPages - processed;
      const limit = Math.min(pageSize, remaining);
      const { results, nextStart } = await this.searchContent(http, options, start, limit);
      if (!results.length) {
        break;
      }

      const batch: NormalizedArtifact[] = [];
      for (const page of results) {
        if (page.type !== 'page') {
          continue;
        }
        const artifact = this.buildArtifact(page, options);
        if (artifact) {
          batch.push(artifact);
          processed += 1;
          if (processed >= options.maxPages) {
            break;
          }
        }
      }

      await emitBatch(batch);

      if (!nextStart || processed >= options.maxPages) {
        break;
      }
      start = nextStart;
    }

    if (context?.emitBatch) {
      return;
    }
    return collected;
  }

  async buildNavigation(_sourceId: string): Promise<PluginNavigationPayload> {
    return { nodes: [] };
  }

  private normalizeOptions(raw: ConfluencePluginOptions): NormalizedConfluenceOptions {
    if (!raw?.baseUrl) {
      throw new BadRequestException('Confluence plugin requires baseUrl in source options');
    }
    const trimmed = raw.baseUrl.trim();
    const baseUrl = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;

    const normalizeList = (value?: string | string[]): string[] => {
      if (Array.isArray(value)) {
        return value.map((entry) => entry?.trim()).filter((entry): entry is string => Boolean(entry));
      }
      if (typeof value === 'string') {
        return value
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
      return [];
    };

    const spaceKeys = normalizeList(raw.spaceKeys);
    if (raw.spaceKey?.trim()) {
      spaceKeys.push(raw.spaceKey.trim());
    }
    const labelFilters = normalizeList(raw.labelFilters);

    const includeArchived = Boolean(raw.includeArchived);
    const maxPages =
      raw.maxPages && Number.isFinite(raw.maxPages)
        ? Math.max(1, Math.min(1000, Number(raw.maxPages)))
        : 200;

    let authHeader: string | undefined;
    const pat = raw.personalAccessToken?.trim();
    const email = raw.userEmail?.trim();
    const token = raw.apiToken?.trim();
    if (pat) {
      authHeader = `Bearer ${pat}`;
    } else if (email && token) {
      const encoded = Buffer.from(`${email}:${token}`).toString('base64');
      authHeader = `Basic ${encoded}`;
    }

    const searchCql = raw.cql?.trim() || this.buildDefaultCql({
      spaceKeys,
      labelFilters,
      rootPageId: raw.rootPageId?.trim(),
      includeArchived
    });

    return {
      baseUrl,
      authHeader,
      searchCql,
      maxPages,
      includeArchived,
      spaceKeys,
      labelFilters,
      rootPageId: raw.rootPageId?.trim() || undefined
    };
  }

  private buildDefaultCql(params: {
    spaceKeys: string[];
    labelFilters: string[];
    rootPageId?: string;
    includeArchived: boolean;
  }): string {
    const clauses = ['type="page"'];
    if (!params.includeArchived) {
      clauses.push('status="current"');
    }
    if (params.spaceKeys.length === 1) {
      clauses.push(`space="${params.spaceKeys[0]}"`);
    } else if (params.spaceKeys.length > 1) {
      const quoted = params.spaceKeys.map((key) => `"${key}"`).join(', ');
      clauses.push(`space in (${quoted})`);
    }
    if (params.rootPageId) {
      clauses.push(`ancestor=${params.rootPageId}`);
    }
    if (params.labelFilters.length === 1) {
      clauses.push(`label="${params.labelFilters[0]}"`);
    } else if (params.labelFilters.length > 1) {
      const labelClause = params.labelFilters.map((label) => `"${label}"`).join(', ');
      clauses.push(`label in (${labelClause})`);
    }
    return clauses.join(' AND ');
  }

  private createHttpClient(options: NormalizedConfluenceOptions): AxiosInstance {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'ArtifactHarvesterConfluence/1.0'
    };
    if (options.authHeader) {
      headers.Authorization = options.authHeader;
    }
    return axios.create({
      baseURL: options.baseUrl,
      timeout: 20000,
      headers,
      paramsSerializer: {
        indexes: null
      }
    });
  }

  private async searchContent(
    http: AxiosInstance,
    options: NormalizedConfluenceOptions,
    start: number,
    limit: number
  ): Promise<{ results: ConfluenceContent[]; nextStart?: number }> {
    try {
      const response = await http.get<ConfluenceSearchResponse>('rest/api/content/search', {
        params: {
          cql: options.searchCql,
          limit,
          start,
          expand: ['body.storage', 'version', 'space', 'metadata.labels'].join(',')
        }
      });

      const payload = response.data;
      let nextStart: number | undefined;
      if (payload?._links?.next) {
        try {
          const nextUrl = new URL(payload._links.next, options.baseUrl);
          const nextStartParam = nextUrl.searchParams.get('start');
          if (nextStartParam) {
            nextStart = Number(nextStartParam);
          }
        } catch {
          nextStart = start + (payload.results?.length ?? 0);
        }
      }

      return {
        results: payload?.results ?? [],
        nextStart
      };
    } catch (error: any) {
      this.logger.error(
        `Confluence search failed at start=${start}: ${error?.message ?? error}`,
        error?.stack
      );
      return { results: [] };
    }
  }

  private buildArtifact(
    page: ConfluenceContent,
    options: NormalizedConfluenceOptions
  ): NormalizedArtifact | null {
    const html = page.body?.storage?.value;
    if (!html) {
      this.logger.debug(`ConfluencePlugin skipped page ${page.id} because body.storage was empty.`);
      return null;
    }
    const text = cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
    const labels =
      page.metadata?.labels?.results
        ?.map((label) => label?.name)
        .filter((label): label is string => Boolean(label)) ?? [];
    const versionNumber = page.version?.number ?? 1;
    const url = this.resolvePageUrl(page, options);
    const timestamp = page.version?.when;

    return {
      externalId: `confluence:${page.id}`,
      displayName: page.title || `Page ${page.id}`,
      version: String(versionNumber),
      data: {
        id: page.id,
        title: page.title,
        spaceKey: page.space?.key ?? null,
        html,
        text,
        version: versionNumber,
        labels,
        status: page.status,
        url
      },
      metadata: {
        confluenceId: page.id,
        spaceKey: page.space?.key,
        spaceName: page.space?.name,
        labels,
        versionNumber
      },
      originalUrl: url,
      timestamp
    };
  }

  private resolvePageUrl(page: ConfluenceContent, options: NormalizedConfluenceOptions): string {
    const candidate = page._links?.webui ?? page._links?.self ?? '';
    try {
      if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        return candidate;
      }
      return new URL(candidate, options.baseUrl).toString();
    } catch {
      return options.baseUrl;
    }
  }
}
