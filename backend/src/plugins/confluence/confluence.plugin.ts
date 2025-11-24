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
    export_view?: {
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
  ancestors?: Array<{
    id?: string;
    title?: string;
    type?: string;
  }>;
  _links?: {
    webui?: string;
    tinyui?: string;
    self?: string;
    base?: string;
  };
}

interface ConfluenceChildResponse {
  results?: Array<{
    id: string;
    title?: string;
    type?: string;
    status?: string;
    _links?: {
      webui?: string;
    };
  }>;
  _links?: {
    next?: string;
  };
  start?: number;
  limit?: number;
  size?: number;
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
          description: 'API token for Confluence Cloud (paired with User Email)',
          inputType: 'password'
        },
        {
          name: 'personalAccessToken',
          label: 'Personal Access Token',
          type: 'string',
          description: 'Alternative bearer token for Confluence Data Center / Server',
          inputType: 'password'
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
          description: 'Optional limit for how many pages to crawl. Leave blank to crawl everything.'
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

    if (options.rootPageId) {
      return this.extractFromPageTree(options, http, context);
    }

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
    const processedIds = new Set<string>();
    let nextLink: string | undefined;

    let stoppedDueToMissingNext = false;
    let stoppedDueToApiLimit = false;

    while (processed < options.maxPages) {
      const remaining = options.maxPages - processed;
      const limit = Math.min(pageSize, remaining);
      const { results, nextPageLink, hasNextPage, fallbackNextStart } = await this.searchContent(http, options, {
        start: nextLink ? undefined : start,
        limit,
        nextLink
      });
      if (!results.length) {
        break;
      }

      const batch: NormalizedArtifact[] = [];
      for (const page of results) {
        if (page.type !== 'page') {
          continue;
        }
        if (!page.id || processedIds.has(page.id)) {
          continue;
        }
        processedIds.add(page.id);
        this.logger.debug(
          `ConfluencePlugin processing search result ${page.id} ("${page.title ?? 'Untitled'}")`
        );
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

      if (processed >= options.maxPages) {
        break;
      }

      if (!nextPageLink) {
        if (hasNextPage && typeof fallbackNextStart === 'number' && fallbackNextStart > start) {
          nextLink = undefined;
          start = fallbackNextStart;
          continue;
        }
        if (hasNextPage) {
          stoppedDueToMissingNext = true;
        } else if (!hasNextPage && results.length === limit && processed < options.maxPages) {
          stoppedDueToApiLimit = true;
        }
        break;
      }
      nextLink = nextPageLink;
    }

    this.logger.log(
      `ConfluencePlugin processed ${processed} page(s) (maxPages=${options.maxPages}).`
    );

    if (stoppedDueToMissingNext) {
      this.logger.warn(
        'ConfluencePlugin stopped early because the API did not include a usable next page link. Consider reducing filters or retrying with smaller maxPages.'
      );
    } else if (stoppedDueToApiLimit) {
      this.logger.warn(
        'ConfluencePlugin likely hit Confluence search result limits before reaching maxPages. Narrow the search (space/labels/cql) or use rootPageId to crawl smaller sections.'
      );
    }

    if (Number.isFinite(options.maxPages) && processed >= options.maxPages) {
      this.logger.warn(
        `ConfluencePlugin reached maxPages limit (${options.maxPages}). Increase maxPages in the source options to scan additional pages.`
      );
    }

    if (context?.emitBatch) {
      return;
    }
    return collected;
  }

  private async extractFromPageTree(
    options: NormalizedConfluenceOptions,
    http: AxiosInstance,
    context?: PluginExtractContext
  ): Promise<NormalizedArtifact[] | void> {
    this.logger.log(
      `ConfluencePlugin crawling tree from root ${options.rootPageId} at ${options.baseUrl}`
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

    const queue: Array<{ id: string; parentId?: string; ancestors: string[] }> = [
      { id: options.rootPageId!, parentId: undefined, ancestors: [] }
    ];
    const visited = new Set<string>();
    let processed = 0;

    while (queue.length > 0 && processed < options.maxPages) {
      const current = queue.shift()!;
      if (visited.has(current.id)) {
        continue;
      }
      visited.add(current.id);

      const page = await this.fetchPageById(http, current.id);
      if (!page) {
        continue;
      }

      this.logger.debug(
        `ConfluencePlugin processing page ${page.id} ("${page.title ?? 'Untitled'}")`
      );

      const artifact = this.buildArtifact(page, options, {
        allowEmptyHtml: true,
        parentPageId: current.parentId,
        ancestors: current.ancestors
      });
      if (artifact) {
        await emitBatch([artifact]);
        processed += 1;
        if (processed >= options.maxPages) {
          break;
        }
      }

      const children = await this.fetchChildPages(http, current.id);
      children.forEach((child) => {
        if (!visited.has(child.id)) {
          queue.push({
            id: child.id,
            parentId: page.id,
            ancestors: [...current.ancestors, page.title || page.id]
          });
        }
      });
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
    const baseUrl = this.normalizeBaseUrl(raw.baseUrl);

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

    const rawSpaceKeys = normalizeList(raw.spaceKeys);
    if (raw.spaceKey?.trim()) {
      rawSpaceKeys.push(raw.spaceKey.trim());
    }
    const normalizedSpaceKeys: string[] = [];
    const seenSpaceKeys = new Set<string>();
    for (const key of rawSpaceKeys) {
      const normalizedKey = key.toUpperCase();
      if (seenSpaceKeys.has(normalizedKey)) {
        continue;
      }
      seenSpaceKeys.add(normalizedKey);
      normalizedSpaceKeys.push(key);
    }
    const labelFilters = normalizeList(raw.labelFilters);

    const includeArchived = Boolean(raw.includeArchived);
    const maxPagesInput =
      raw.maxPages && Number.isFinite(raw.maxPages) ? Number(raw.maxPages) : undefined;
    const maxPages =
      maxPagesInput !== undefined ? Math.max(1, Math.trunc(maxPagesInput)) : Number.POSITIVE_INFINITY;

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

    const rootPageId = this.normalizeRootPageId(raw.rootPageId);

    const searchCql = raw.cql?.trim() || this.buildDefaultCql({
      spaceKeys: normalizedSpaceKeys,
      labelFilters,
      rootPageId,
      includeArchived
    });

    return {
      baseUrl,
      authHeader,
      searchCql,
      maxPages,
      includeArchived,
      spaceKeys: normalizedSpaceKeys,
      labelFilters,
      rootPageId
    };
  }

  private normalizeBaseUrl(value: string): string {
    const ensureTrailingSlash = (input: string) => (input.endsWith('/') ? input : `${input}/`);
    const trimmed = value.trim();
    if (!trimmed) {
      return '/';
    }
    try {
      const parsed = new URL(trimmed);
      const lowerPath = parsed.pathname.toLowerCase();
      const wikiIndex = lowerPath.indexOf('/wiki');
      if (wikiIndex >= 0) {
        parsed.pathname = parsed.pathname.slice(0, wikiIndex + '/wiki'.length);
      } else if (parsed.hostname.endsWith('.atlassian.net')) {
        parsed.pathname = '/wiki';
      }
      parsed.search = '';
      parsed.hash = '';
      const normalized = parsed.toString();
      return ensureTrailingSlash(normalized);
    } catch {
      return ensureTrailingSlash(trimmed);
    }
  }

  private buildDefaultCql(params: {
    spaceKeys: string[];
    labelFilters: string[];
    rootPageId?: string;
    includeArchived: boolean;
  }): string {
    const clauses = ['type=page'];
    if (params.spaceKeys.length === 1) {
      clauses.push(`space=${this.formatCqlIdentifier(params.spaceKeys[0])}`);
    } else if (params.spaceKeys.length > 1) {
      const formatted = params.spaceKeys.map((key) => this.formatCqlIdentifier(key)).join(', ');
      clauses.push(`space in (${formatted})`);
    }
    if (params.rootPageId) {
      clauses.push(`ancestor=${params.rootPageId}`);
    }
    if (params.labelFilters.length === 1) {
      clauses.push(`label=${this.formatCqlIdentifier(params.labelFilters[0])}`);
    } else if (params.labelFilters.length > 1) {
      const labelClause = params.labelFilters.map((label) => this.formatCqlIdentifier(label)).join(', ');
      clauses.push(`label in (${labelClause})`);
    }
    return clauses.join(' AND ');
  }

  private formatCqlIdentifier(value: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      return '""';
    }
    if (/^[A-Za-z0-9._-]+$/.test(trimmed)) {
      return trimmed;
    }
    return `"${trimmed.replace(/"/g, '\\"')}"`;
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
    pagination: { start?: number; limit: number; nextLink?: string }
  ): Promise<{
    results: ConfluenceContent[];
    nextPageLink?: string;
    hasNextPage: boolean;
    fallbackNextStart?: number;
  }> {
    try {
      const { start, limit, nextLink } = pagination;
      const endpoint = nextLink ?? 'rest/api/content/search';
      const response = await http.get<ConfluenceSearchResponse>(endpoint, nextLink
        ? undefined
        : {
            params: {
              cql: options.searchCql,
              limit,
              start,
              expand: ['body.storage', 'body.export_view', 'version', 'space', 'metadata.labels', 'ancestors'].join(',')
            }
          });

      const payload = response.data;
      const hasNextPage = Boolean(payload?._links?.next);
      const nextPageLink = payload?._links?.next;
      const fallbackNextStart =
        typeof payload?.start === 'number'
          ? payload.start + (payload.limit ?? payload.results?.length ?? limit)
          : undefined;
      return {
        results: payload?.results ?? [],
        nextPageLink,
        hasNextPage,
        fallbackNextStart
      };
    } catch (error) {
      const details = this.extractErrorDetails(error);
      this.logger.error(
        `Confluence search failed at start=${pagination.start ?? 0}: ${details}`,
        error instanceof Error ? error.stack : undefined
      );
      return { results: [], hasNextPage: false };
    }
  }

  private async fetchPageById(
    http: AxiosInstance,
    pageId: string
  ): Promise<ConfluenceContent | null> {
    try {
      const response = await http.get<ConfluenceContent>(`rest/api/content/${pageId}`, {
        params: {
          expand: ['body.storage', 'body.export_view', 'version', 'space', 'metadata.labels', 'ancestors'].join(',')
        }
      });
      return response.data;
    } catch (error) {
      const details = this.extractErrorDetails(error);
      this.logger.warn(`ConfluencePlugin could not fetch page ${pageId}: ${details}`);
      return null;
    }
  }

  private async fetchChildPages(http: AxiosInstance, pageId: string): Promise<Array<{ id: string; title?: string }>> {
    const children: Array<{ id: string; title?: string }> = [];
    let start = 0;
    const limit = 50;
    while (start < 1000) {
      try {
        const response = await http.get<ConfluenceChildResponse>(`rest/api/content/${pageId}/child/page`, {
          params: {
            limit,
            start
          }
        });
        const payload = response.data;
        payload.results?.forEach((result) => {
          if (result?.id) {
            children.push({ id: result.id, title: result.title });
          }
        });
        if (!payload._links?.next || !payload.results?.length) {
          break;
        }
        start += payload.results.length;
      } catch (error) {
        const details = this.extractErrorDetails(error);
        this.logger.warn(`ConfluencePlugin failed to load children for ${pageId}: ${details}`);
        break;
      }
    }
    return children;
  }

  private extractErrorDetails(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      const summary = this.safeStringify(data);
      return `status=${status ?? 'unknown'} message=${error.message}${summary ? ` body=${summary}` : ''}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private safeStringify(value: unknown): string | undefined {
    if (value == null) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }

  private buildArtifact(
    page: ConfluenceContent,
    options: NormalizedConfluenceOptions,
    extra?: { allowEmptyHtml?: boolean; parentPageId?: string; ancestors?: string[] }
  ): NormalizedArtifact | null {
    const rawHtml = page.body?.storage?.value ?? page.body?.export_view?.value;
    const isFolder = !rawHtml;
    if (!rawHtml && !extra?.allowEmptyHtml) {
      this.logger.debug(`ConfluencePlugin skipped page ${page.id} because body content was empty.`);
      return null;
    }
    const html = rawHtml ?? '';
    const text = html ? cheerio.load(html).root().text().replace(/\s+/g, ' ').trim() : '';
    const labels =
      page.metadata?.labels?.results
        ?.map((label) => label?.name)
        .filter((label): label is string => Boolean(label)) ?? [];
    const versionNumber = page.version?.number ?? 1;
    const url = this.resolvePageUrl(page, options);
    const timestamp = page.version?.when;
    const baseAncestors = extra?.ancestors ?? this.extractAncestorTitles(page);
    const pathSegments = [...baseAncestors, page.title || `Page ${page.id}`];
    const folderPath = baseAncestors.join(' / ');

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
        versionNumber,
        parentPageId: extra?.parentPageId,
        pathSegments,
        folderPath,
        isFolder
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

  private normalizeRootPageId(value?: string): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }
    try {
      const url = new URL(trimmed);
      const queryId = url.searchParams.get('pageId');
      if (queryId) {
        return queryId;
      }
      const pathMatch = url.pathname.match(/\/pages\/(\d+)\//);
      if (pathMatch?.[1]) {
        return pathMatch[1];
      }
      const segments = url.pathname.split('/').filter(Boolean);
      const numericSegment = segments.find((segment) => /^\d+$/.test(segment));
      if (numericSegment) {
        return numericSegment;
      }
    } catch {
      // ignore
    }
    return trimmed;
  }

  private extractAncestorTitles(page: ConfluenceContent): string[] {
    if (!Array.isArray(page.ancestors) || !page.ancestors.length) {
      return [];
    }
    return page.ancestors
      .map((ancestor) => ancestor.title?.trim() || ancestor.id)
      .filter((value): value is string => Boolean(value));
  }

}
