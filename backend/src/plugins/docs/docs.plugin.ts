import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios, { AxiosInstance, RawAxiosResponseHeaders } from 'axios';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { Plugin, PluginNavigationPayload, NormalizedArtifact, PluginExtractContext } from '../interfaces.js';
import { SourceEntity } from '../../sources/source.entity.js';

interface DocsPluginOptions {
  baseUrl: string;
  versionIndexPath?: string;
  versionSelector?: string;
  versionLabelAttribute?: string;
  versionPathAttribute?: string;
  manualVersions?: string[];
  startPaths?: string[];
  followSelector?: string;
  contentSelector?: string;
  titleSelector?: string;
  headingSelector?: string;
  maxPages?: number;
  userAgent?: string;
  allowedDomains?: string[];
}

interface NormalizedDocsOptions {
  baseUrl: string;
  versionIndexPath: string;
  versionSelector?: string;
  versionLabelAttribute?: string;
  versionPathAttribute?: string;
  manualVersions: string[];
  startPaths: string[];
  followSelector: string;
  contentSelectors: string[];
  titleSelectors: string[];
  headingSelectors: string[];
  maxPages: number;
  userAgent: string;
  siteFlavor: 'docusaurus' | 'generic';
  allowedOrigins: string[];
  origin: string;
}

interface DocsVersion {
  key: string;
  label: string;
  rootUrl: string;
}

const DEFAULT_CONTENT_SELECTORS = ['article', 'main', '#content'];
const DEFAULT_TITLE_SELECTORS = ['title', 'h1'];
const DEFAULT_HEADING_SELECTORS = ['h2', 'h3'];
const VERSION_SELECTOR_HINTS = [
  '[data-docs-version]',
  '[data-doc-version]',
  '[data-current-version]',
  '[data-version]',
  '.docs-version',
  '.documentation-version',
  '.version-banner',
  '.version-badge',
  '.doc-version',
  '.docVersion',
  '.package-version',
  '#documentation-version',
  '#doc-version',
  '#version-banner'
];
const VERSION_ATTRIBUTE_HINTS = [
  'data-docs-version',
  'data-doc-version',
  'data-documentation-version',
  'data-current-version',
  'data-version',
  'data-release',
  'data-package-version'
];
const VERSION_TEXT_KEYWORDS = ['documentation version', 'docs version', 'package version', 'sdk version'];
const SMART_CONTENT_CANDIDATES = [
  'main',
  '[role="main"]',
  '[role="document"]',
  'article',
  '#main-content',
  '#doc-content',
  '#docs-content',
  '#documentation',
  '#page-content',
  '.doc-content',
  '.docs-content',
  '.documentation',
  '.docMainContainer',
  '.theme-doc-markdown',
  '.markdown-body',
  '.td-content',
  '.content',
  '.content-area',
  '.article',
  '.article-content',
  '.prose'
];

const VERSION_META_SELECTORS = [
  'meta[name="doc:version"]',
  'meta[name="doc:current-version"]',
  'meta[name="version"]',
  'meta[property="og:version"]',
  'meta[name="article:version"]'
];

@Injectable()
export class DocsPlugin implements Plugin {
  private readonly logger = new Logger(DocsPlugin.name);

  readonly descriptor = {
    key: 'docs',
    name: 'Documentation Crawler',
    optionsSchema: {
      fields: [
        { name: 'baseUrl', label: 'Base URL', type: 'string', required: true },
        {
          name: 'versionIndexPath',
          label: 'Version Index Path',
          type: 'string',
          description: 'Relative path that lists available versions (default: /)'
        },
        {
          name: 'allowedDomains',
          label: 'Allowed Domains',
          type: 'array',
          description: 'Optional additional domains to crawl (one per line, e.g. docs2.example.com)'
        },
        {
          name: 'versionSelector',
          label: 'Version Link Selector',
          type: 'string',
          description: 'CSS selector to find anchors for version links'
        },
        {
          name: 'versionLabelAttribute',
          label: 'Version Label Attribute',
          type: 'string',
          description: 'Optional attribute name to use for version labels instead of text content'
        },
        {
          name: 'versionPathAttribute',
          label: 'Version Path Attribute',
          type: 'string',
          description: 'Optional attribute name to use for version URLs instead of href'
        },
        {
          name: 'manualVersions',
          label: 'Manual Versions (label|path per line)',
          type: 'array',
          description: 'Each entry should look like "v2|/docs/v2/". Label defaults to the path when omitted.'
        },
        {
          name: 'startPaths',
          label: 'Starting Paths (per version)',
          type: 'array',
          description: 'Relative paths to seed the crawl, e.g. "/getting-started"'
        },
        {
          name: 'followSelector',
          label: 'Link Selector',
          type: 'string',
          description: 'CSS selector for anchors that should be followed (default: a[href])'
        },
        {
          name: 'contentSelector',
          label: 'Content Selector',
          type: 'string',
          description: 'Comma-separated selectors for the primary article region'
        },
        {
          name: 'titleSelector',
          label: 'Title Selector',
          type: 'string',
          description: 'Comma-separated selectors for the page title (default: h1, title)'
        },
        {
          name: 'headingSelector',
          label: 'Heading Selector',
          type: 'string',
          description: 'Comma-separated selectors for headings captured into metadata'
        },
        {
          name: 'maxPages',
          label: 'Max Pages Per Version',
          type: 'number',
          description: 'Stops crawling after this many pages per version (default: 50)'
        },
        {
          name: 'userAgent',
          label: 'User Agent',
          type: 'string',
          description: 'Override HTTP user agent when scraping'
        }
      ]
    },
    artifactSchema: {
      fields: [
        { name: 'path', label: 'Path', type: 'string', required: true },
        { name: 'version', label: 'Version', type: 'string', required: true },
        { name: 'title', label: 'Title', type: 'string', required: true },
        { name: 'html', label: 'HTML', type: 'string', required: true },
        { name: 'text', label: 'Text', type: 'string', required: true },
        { name: 'headings', label: 'Headings', type: 'array' }
      ]
    },
    navigationSchema: {
      type: 'tree',
      label: 'Docs Tree',
      description: 'Sections mapped to documentation pages and their versions'
    }
  } as const;

  async extract(source: SourceEntity, context?: PluginExtractContext): Promise<NormalizedArtifact[] | void> {
    const options = this.normalizeOptions(source.options as DocsPluginOptions);
    const http = this.createHttpClient(options);

    const versions = await this.resolveVersions(options, http);
    if (versions.length === 0) {
      this.logger.warn(`No documentation versions discovered for source ${source.id}.`);
      return [];
    }

    this.logger.log(
      `DocsPlugin versions for source ${source.id}: ${versions
        .map((version) => `${version.label} (${version.rootUrl})`)
        .join(', ')}`
    );

    const artifacts: NormalizedArtifact[] = [];
    const emitBatch = async (batch: NormalizedArtifact[]) => {
      if (!batch.length) {
        return;
      }
      if (context?.emitBatch) {
        await context.emitBatch(batch);
      } else {
        artifacts.push(...batch);
      }
    };

    for (const version of versions) {
      const versionArtifacts = await this.crawlVersion(version, options, http);
      await emitBatch(versionArtifacts);
    }

    if (context?.emitBatch) {
      return;
    }

    return artifacts;
  }

  async buildNavigation(_sourceId: string): Promise<PluginNavigationPayload> {
    return { nodes: [] };
  }

  private normalizeOptions(raw: DocsPluginOptions): NormalizedDocsOptions {
    if (!raw?.baseUrl) {
      throw new BadRequestException('Docs plugin requires baseUrl in source options');
    }

    const trimmedBase = raw.baseUrl.trim();
    const baseUrl = trimmedBase.endsWith('/') ? trimmedBase : `${trimmedBase}/`;

    const normalizeList = (value?: string[]): string[] =>
      Array.isArray(value)
        ? value
            .map((entry) => entry?.trim())
            .filter((entry): entry is string => Boolean(entry))
        : [];

    const toSelectorList = (value: string | undefined, fallback: string[]): string[] =>
      value && value.trim().length > 0
        ? value
            .split(',')
            .map((selector) => selector.trim())
            .filter(Boolean)
        : fallback;

    const maxPages =
      raw.maxPages && Number.isFinite(raw.maxPages) ? Math.max(Number(raw.maxPages), 1) : 50;

    const allowedOrigins = new Set<string>();
    let origin = '';
    try {
      const parsed = new URL(baseUrl);
      origin = parsed.origin;
      allowedOrigins.add(parsed.origin);
    } catch {
      // ignore
    }
    normalizeList(raw.allowedDomains).forEach((entry) => {
      try {
        const url = entry.includes('://') ? new URL(entry) : new URL(`https://${entry}`);
        allowedOrigins.add(url.origin);
      } catch {
        this.logger.warn(`DocsPlugin ignored invalid allowed domain: ${entry}`);
      }
    });

    return {
      baseUrl,
      versionIndexPath: raw.versionIndexPath?.trim() || '/',
      versionSelector: raw.versionSelector?.trim() || undefined,
      versionLabelAttribute: raw.versionLabelAttribute?.trim() || undefined,
      versionPathAttribute: raw.versionPathAttribute?.trim() || undefined,
      manualVersions: normalizeList(raw.manualVersions),
      startPaths: normalizeList(raw.startPaths),
      followSelector: raw.followSelector?.trim() || 'a[href]',
      contentSelectors: toSelectorList(raw.contentSelector, DEFAULT_CONTENT_SELECTORS),
      titleSelectors: toSelectorList(raw.titleSelector, DEFAULT_TITLE_SELECTORS),
      headingSelectors: toSelectorList(raw.headingSelector, DEFAULT_HEADING_SELECTORS),
      maxPages,
      userAgent: raw.userAgent?.trim() || 'ArtifactHarvesterDocs/1.0',
      siteFlavor: this.detectSiteFlavor(raw),
      allowedOrigins: Array.from(allowedOrigins),
      origin
    };
  }

  private detectSiteFlavor(raw: DocsPluginOptions): 'docusaurus' | 'generic' {
    const selectors = [
      raw.versionSelector,
      raw.contentSelector,
      raw.titleSelector,
      raw.headingSelector
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (selectors.includes('.doc-main-container') || selectors.includes('.theme-doc')) {
      return 'docusaurus';
    }

    const url = raw.baseUrl?.toLowerCase() ?? '';
    if (url.includes('docs.') || url.includes('docusaurus')) {
      return 'docusaurus';
    }

    return 'generic';
  }

  private createHttpClient(options: NormalizedDocsOptions) {
    return axios.create({
      headers: {
        'User-Agent': options.userAgent,
        Accept: 'text/html,application/xhtml+xml'
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400
    });
  }

  async listVersions(source: SourceEntity): Promise<DocsVersion[]> {
    const options = this.normalizeOptions(source.options as DocsPluginOptions);
    const http = this.createHttpClient(options);
    const versions = await this.resolveVersions(options, http);
    return versions;
  }

  private async resolveVersions(options: NormalizedDocsOptions, http: AxiosInstance): Promise<DocsVersion[]> {
    const manual = this.parseManualVersions(options);
    if (manual.length > 0) {
      this.logger.debug(`DocsPlugin using ${manual.length} manually provided version(s).`);
      return manual;
    }

    const detectionCandidates: Array<{ weight: number; versions: DocsVersion[] }> = [];

    if (options.versionSelector) {
      const versions = await this.discoverFromSelector(options, http);
      if (versions.length) {
        detectionCandidates.push({ weight: 3, versions });
      }
    }

    const autoDiscovered = await this.autoDiscoverVersions(options, http);
    if (autoDiscovered.length > 0) {
      detectionCandidates.push({ weight: 2, versions: autoDiscovered });
    }

    const fallbackVersions = await this.fallbackVersionDiscovery(options, http);
    if (fallbackVersions.length > 0) {
      detectionCandidates.push({ weight: 1, versions: fallbackVersions });
    }

    if (detectionCandidates.length > 0) {
      detectionCandidates.sort((a, b) => b.weight - a.weight);
      const merged = new Map<string, DocsVersion>();
      detectionCandidates.forEach(({ versions }) => {
        versions.forEach((version) => {
          if (!merged.has(version.rootUrl)) {
            merged.set(version.rootUrl, version);
          }
        });
      });
      const list = Array.from(merged.values());
      this.logger.debug(
        `DocsPlugin discovered ${list.length} version(s): ${list.map((v) => v.label).join(', ')}`
      );
      return list;
    }

    const fallback = [this.buildVersionDescriptor(options, 'latest', '/')];
    this.logger.debug('DocsPlugin falling back to default "latest" version only.');
    return fallback;
  }

  private async discoverFromSelector(options: NormalizedDocsOptions, http: AxiosInstance) {
    const indexUrl = new URL(options.versionIndexPath || '/', options.baseUrl).toString();
    const document = await this.fetchDocument(http, indexUrl);
    if (!document) {
      return [];
    }
    return this.scrapeVersionsFromDocument(document.html, options);
  }

  private parseManualVersions(options: NormalizedDocsOptions): DocsVersion[] {
    if (!options.manualVersions.length) {
      return [];
    }

    return options.manualVersions.map((entry, index) => {
      const [labelRaw, pathRaw] = entry.split('|');
      const label = (labelRaw ?? pathRaw ?? `version-${index + 1}`).trim();
      const path = (pathRaw ?? labelRaw ?? '/').trim();
      return this.buildVersionDescriptor(options, label || `version-${index + 1}`, path || '/');
    });
  }

  private async autoDiscoverVersions(
    options: NormalizedDocsOptions,
    http: AxiosInstance
  ): Promise<DocsVersion[]> {
    try {
      const versions = new Map<string, DocsVersion>();
      const seedPaths = new Set<string>();
      seedPaths.add(options.versionIndexPath || '/');
      try {
        const basePath = new URL(options.baseUrl).pathname || '/';
        seedPaths.add(basePath);
      } catch {
        seedPaths.add('/');
      }
      options.startPaths.forEach((path) => {
        if (path?.trim()) {
          seedPaths.add(path.trim());
        }
      });

      for (const seed of Array.from(seedPaths).slice(0, 5)) {
        const seedUrl = new URL(seed || '/', options.baseUrl).toString();
        const document = await this.fetchDocument(http, seedUrl);
        if (!document) {
          continue;
        }
        this.discoverVersionsFromLinks(document.html, options).forEach((version) => {
          versions.set(version.rootUrl, version);
        });
        this.discoverVersionsFromOptionLists(document.html, options).forEach((version) => {
          if (!versions.has(version.rootUrl)) {
            versions.set(version.rootUrl, version);
          }
        });
      }

      const jsonVersions = await this.discoverVersionsFromJson(options, http);
      jsonVersions.forEach((version) => {
        if (!versions.has(version.rootUrl)) {
          versions.set(version.rootUrl, version);
        }
      });
      const sitemapVersions = await this.discoverVersionsFromSitemap(options, http);
      sitemapVersions.forEach((version) => {
        if (!versions.has(version.rootUrl)) {
          versions.set(version.rootUrl, version);
        }
      });
      return Array.from(versions.values());
    } catch (error) {
      this.logger.debug(`Auto version discovery failed: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  private discoverVersionsFromLinks(html: string, options: NormalizedDocsOptions): DocsVersion[] {
    const $ = cheerio.load(html);
    const versions = new Map<string, DocsVersion>();

    $('a[href]')
      .toArray()
      .forEach((element) => {
        const href = $(element).attr('href');
        const descriptor = this.buildVersionFromHref(href, options);
        if (descriptor && !versions.has(descriptor.rootUrl)) {
          versions.set(descriptor.rootUrl, descriptor);
        }
      });

    return Array.from(versions.values());
  }

  private discoverVersionsFromOptionLists(html: string, options: NormalizedDocsOptions): DocsVersion[] {
    const $ = cheerio.load(html);
    const versions = new Map<string, DocsVersion>();
    const addCandidate = (token?: string | null) => {
      const cleaned = token?.trim();
      if (!cleaned || !this.isVersionSegment(cleaned)) {
        return;
      }
      const descriptor = this.buildVersionDescriptor(options, this.formatVersionLabel(cleaned), `/${cleaned}/`);
      if (!versions.has(descriptor.rootUrl)) {
        versions.set(descriptor.rootUrl, descriptor);
      }
    };

    $('option').each((_, element) => {
      const value = $(element).attr('value') ?? $(element).text();
      addCandidate(value);
    });

    $('[data-value], [data-version]').each((_, element) => {
      const value = $(element).attr('data-version') ?? $(element).attr('data-value');
      addCandidate(value);
    });

    return Array.from(versions.values());
  }

  private async discoverVersionsFromJson(
    options: NormalizedDocsOptions,
    http: AxiosInstance
  ): Promise<DocsVersion[]> {
    try {
      const base = new URL(options.baseUrl);
      const versionsUrl = new URL('versions.json', `${base.protocol}//${base.host}`).toString();
      const response = await http.get(versionsUrl, {
        responseType: 'json',
        headers: { Accept: 'application/json' }
      });
      const payload = response.data;
      this.logger.debug(`DocsPlugin versions.json raw response: ${JSON.stringify(payload)}`);
      if (!Array.isArray(payload) && typeof payload !== 'object') {
        return [];
      }
      const versions: DocsVersion[] = [];
      const entries = Array.isArray(payload) ? payload : Object.values(payload);
      entries.forEach((entry: any) => {
        const raw = typeof entry === 'string' ? entry : entry?.name ?? entry?.label ?? entry?.version ?? entry;
        if (!raw || typeof raw !== 'string') {
          return;
        }
        const cleaned = raw.trim();
        if (!cleaned) {
          return;
        }
        if (cleaned.toLowerCase() === 'current') {
          versions.push(this.buildVersionDescriptor(options, 'latest', '/'));
          return;
        }
        if (this.isVersionSegment(cleaned)) {
          versions.push(this.buildVersionDescriptor(options, this.formatVersionLabel(cleaned), `/${cleaned}/`));
        }
      });
      return versions;
    } catch (error) {
      this.logger.warn(
        `DocsPlugin could not fetch versions.json: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private async discoverVersionsFromSitemap(
    options: NormalizedDocsOptions,
    http: AxiosInstance
  ): Promise<DocsVersion[]> {
    try {
      const origin = new URL(options.baseUrl);
      const url = new URL('sitemap.xml', `${origin.protocol}//${origin.host}`).toString();
      const response = await http.get(url, { responseType: 'text', headers: { Accept: 'application/xml' } });
      const xml = response.data as string;
      const matches = xml.match(/<loc>(.*?)<\/loc>/g);
      if (!matches) {
        return [];
      }
      const versions = new Map<string, DocsVersion>();
      matches.forEach((match) => {
        const loc = match.replace(/<\/?loc>/g, '').trim();
        try {
          const target = new URL(loc);
          const segments = target.pathname.split('/').filter(Boolean);
          if (segments.length === 0) {
            return;
          }
          const candidate = segments[0];
          if (!this.isVersionSegment(candidate)) {
            return;
          }
          const descriptor = this.buildVersionDescriptor(
            options,
            this.formatVersionLabel(candidate),
            `/${candidate}/`
          );
          if (!versions.has(descriptor.rootUrl)) {
            versions.set(descriptor.rootUrl, descriptor);
          }
        } catch {
          /* ignore */
        }
      });
      if (versions.size) {
        this.logger.debug(
          `DocsPlugin sitemap-derived versions: ${Array.from(versions.values())
            .map((version) => version.label)
            .join(', ')}`
        );
      }
      return Array.from(versions.values());
    } catch (error) {
      this.logger.warn(
        `DocsPlugin could not fetch sitemap.xml: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private async fallbackVersionDiscovery(
    options: NormalizedDocsOptions,
    http: AxiosInstance
  ): Promise<DocsVersion[]> {
    if (options.siteFlavor === 'docusaurus') {
      const viaJson = await this.discoverVersionsFromJson(options, http);
      if (viaJson.length > 0) {
        return viaJson;
      }
    }
    const auto = await this.autoDiscoverVersions(options, http);
    if (auto.length > 0) {
      return auto;
    }
    return [];
  }

  private buildVersionFromHref(href: string | undefined, options: NormalizedDocsOptions): DocsVersion | null {
    if (!href) {
      return null;
    }
    try {
      const url = new URL(href, options.baseUrl);
      const relative = url.pathname || '/';
      if (relative === '/' || relative === options.versionIndexPath) {
        return null;
      }
      const segments = relative.split('/').filter(Boolean);
      if (segments.length === 0) {
        return null;
      }
      const versionIndex = segments.findIndex((segment) => this.isVersionSegment(segment));
      if (versionIndex === -1) {
        return null;
      }
      const versionSegment = segments[versionIndex];
      const versionPathSegments = segments.slice(0, versionIndex + 1);
      const versionPath = `/${versionPathSegments.join('/')}/`;
      const label = this.formatVersionLabel(versionSegment);
      return this.buildVersionDescriptor(options, label, versionPath);
    } catch {
      return null;
    }
  }

  private isVersionSegment(segment: string): boolean {
    return /^v?\d+(?:\.\d+){0,3}$/.test(segment) || ['latest', 'stable', 'next'].includes(segment.toLowerCase());
  }

  private formatVersionLabel(segment: string): string {
    if (/^v\d+/i.test(segment)) {
      return segment.startsWith('v') ? segment : `v${segment}`;
    }
    if (/^\d/.test(segment)) {
      return segment;
    }
    return segment;
  }

  private scrapeVersionsFromDocument(html: string, options: NormalizedDocsOptions): DocsVersion[] {
    const selector = options.versionSelector;
    if (!selector) {
      return [];
    }
    const $ = cheerio.load(html);
    const versions: DocsVersion[] = [];
    $(selector)
      .toArray()
      .forEach((element, index) => {
        const node = $(element);
        const label = (options.versionLabelAttribute
          ? node.attr(options.versionLabelAttribute)
          : node.text()
        )?.trim();
        const path = (options.versionPathAttribute
          ? node.attr(options.versionPathAttribute)
          : node.attr('href')
        )?.trim();
        if (!path) {
          return;
        }
        const version = this.buildVersionDescriptor(
          options,
          label || `version-${index + 1}`,
          path
        );
        versions.push(version);
      });

    const unique = new Map<string, DocsVersion>();
    versions.forEach((version) => {
      if (!unique.has(version.rootUrl)) {
        unique.set(version.rootUrl, version);
      }
    });
    return Array.from(unique.values());
  }

  private async crawlVersion(
    version: DocsVersion,
    options: NormalizedDocsOptions,
    http: AxiosInstance
  ): Promise<NormalizedArtifact[]> {
    const artifacts: NormalizedArtifact[] = [];
    const seeds = options.startPaths.length ? options.startPaths : ['/'];
    const queue: string[] = seeds.map((seed) => this.normalizeRelativePath(seed));
    const visited = new Set<string>();

    while (queue.length > 0 && artifacts.length < options.maxPages) {
      const nextPath = this.normalizeRelativePath(queue.shift() || '/');
      if (visited.has(nextPath)) {
        continue;
      }
      visited.add(nextPath);

      let effectivePath = nextPath;
      let url = this.buildPageUrl(version, nextPath);
      let document = await this.fetchDocument(http, url);
      if (!document) {
        continue;
      }

      const $ = cheerio.load(document.html);
      const artifact = this.buildArtifact(version, effectivePath, $, url, document.headers, options);
      if (artifact) {
        artifacts.push(artifact);
      }

      if (artifacts.length >= options.maxPages) {
        break;
      }

      const links = this.extractLinks(version, $, options.followSelector, url);
      for (const link of links) {
        if (!visited.has(link) && queue.length < options.maxPages * 3) {
          queue.push(link);
        }
      }
    }

    const suffix = this.trimCommonTitleSuffix(artifacts);
    if (suffix) {
      artifacts.forEach((artifact) => {
        artifact.metadata = {
          ...(artifact.metadata ?? {}),
          titleSuffix: suffix
        };
      });
    }

    const displayVersion =
      artifacts.find((artifact) => artifact.metadata?.packageVersion)?.metadata?.packageVersion ?? version.label;

    this.logger.debug(
      `DocsPlugin crawled ${artifacts.length} page(s) for version ${displayVersion} (${version.rootUrl}).`
    );
    return artifacts;
  }

  private buildArtifact(
    version: DocsVersion,
    path: string,
    $: cheerio.CheerioAPI,
    url: string,
    headers: RawAxiosResponseHeaders,
    options: NormalizedDocsOptions
  ): NormalizedArtifact | null {
    this.stripPageChrome($);
    this.stripInlineSvg($);
    this.ensureHeadingAnchors($, options.headingSelectors);
    const title = this.sanitizeTitle(this.pickFirstText($, options.titleSelectors) || 'Untitled');
    const html = this.extractContentHtml($, options);
    if (!html) {
      this.logger.debug(`DocsPlugin skipped ${url} because no content matched selectors.`);
      return null;
    }

    const text = cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
    const headings = this.collectHeadings($, options.headingSelectors);
    const timestamp = this.extractTimestamp(headers);
    const metadata: Record<string, any> = {
      versionKey: version.key,
      versionRoot: version.rootUrl,
      versionBasePath: this.getVersionBasePath(version)
    };
    const packageVersion = this.detectPackageVersion($, title, version.label);
    if (packageVersion) {
      metadata.packageVersion = packageVersion;
    }
    const descriptorVersion = version.label?.toLowerCase() === 'latest' ? undefined : version.label;
    const resolvedVersion = packageVersion ?? descriptorVersion ?? 'unknown';

    const artifactPayload: NormalizedArtifact = {
      externalId: this.buildExternalId(version.key, path),
      displayName: title,
      version: resolvedVersion,
      data: {
        path,
        version: resolvedVersion,
        packageVersion: packageVersion ?? descriptorVersion ?? 'unknown',
        title,
        html,
        text,
        headings
      },
      metadata,
      originalUrl: url,
      timestamp
    };

    this.logger.debug(`DocsPlugin [${resolvedVersion}] processed ${path} (${url})`);

    return artifactPayload;
  }

  private stripPageChrome($: cheerio.CheerioAPI): void {
    // XRPL and similar portals inject heavy UI controls (PageActions menu + LinkIcon SVGs)
    // directly into headings; strip them so they do not dominate harvested content.
    const chromeSelectors = [
      '[class*="PageActions"]',
      '[class*="pageactions"]',
      '[class*="page-actions"]',
      '[data-component-name*="PageActions"]',
      '[data-component-name*="pageactions"]',
      '[data-component-name*="page-actions"]',
      'svg[class*="LinkIcon"]',
      'svg[data-component-name*="LinkIcon"]'
    ];
    $(chromeSelectors.join(', ')).remove();
  }

  private stripInlineSvg($: cheerio.CheerioAPI): void {
    // The UI renders harvested docs in a shared viewer that should stay text-first;
    // aggressively remove inline SVG artwork so plugin results remain lightweight.
    $('svg').remove();
  }

  private extractLinks(
    version: DocsVersion,
    $: cheerio.CheerioAPI,
    selector: string,
    currentUrl: string
  ): string[] {
    const links = new Set<string>();
    $(selector)
      .toArray()
      .forEach((element) => {
        const href = $(element).attr('href');
        if (!href || href.startsWith('#')) {
          return;
        }
        const normalized = this.normalizeLink(version, href, currentUrl);
        if (normalized) {
          links.add(normalized);
        }
      });
    return Array.from(links);
  }

  private normalizeLink(version: DocsVersion, href: string, currentUrl: string): string | null {
    try {
      const versionRoot = new URL(version.rootUrl);
      const base = new URL(currentUrl);
      const absolute = new URL(href, base);
      if (absolute.origin !== versionRoot.origin) {
        return null;
      }

      const rootPath = versionRoot.pathname.endsWith('/')
        ? versionRoot.pathname
        : `${versionRoot.pathname}/`;
      const targetPath = absolute.pathname;
      const rootPathWithoutTrailing = rootPath === '/' ? '/' : rootPath.replace(/\/+$/, '/');
      const rootPathBare = rootPathWithoutTrailing === '/' ? '/' : rootPathWithoutTrailing.slice(0, -1);

      const matchesRoot =
        rootPathWithoutTrailing === '/' ||
        targetPath === rootPathBare ||
        targetPath.startsWith(rootPathWithoutTrailing);
      if (!matchesRoot) {
        return null;
      }

      if (rootPathWithoutTrailing === '/') {
        return targetPath;
      }

      if (targetPath === rootPathBare) {
        return '/';
      }

      const relative = targetPath.slice(rootPathWithoutTrailing.length);
      return relative ? `/${relative}` : '/';
    } catch (error) {
      this.logger.debug(`Unable to normalize link ${href}: ${error}`);
      return null;
    }
  }

  private pickFirstText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
    for (const selector of selectors) {
      const text = $(selector).first().text().trim();
      if (text) {
        return text;
      }
    }
    return undefined;
  }

  private pickFirstHtml($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
    for (const selector of selectors) {
      const html = $(selector).first().html();
      if (html) {
        return html;
      }
    }
    return undefined;
  }

  private extractContentHtml($: cheerio.CheerioAPI, options: NormalizedDocsOptions): string | undefined {
    const articleContent = this.pickArticleHtml($);
    if (articleContent) {
      return articleContent;
    }
    const explicit = this.pickFirstHtml($, options.contentSelectors);
    if (explicit) {
      return explicit;
    }
    return this.autoDetectContentHtml($);
  }

  private pickArticleHtml($: cheerio.CheerioAPI): string | undefined {
    const selectorGroups = [
      { selector: 'main article', priority: 3 },
      { selector: '[role="main"] article, article[role="main"]', priority: 2 },
      { selector: 'article', priority: 1 }
    ];
    const processed = new WeakSet<AnyNode>();
    let best: { html: string; score: number } | undefined;

    selectorGroups.forEach(({ selector, priority }) => {
      $(selector)
        .toArray()
        .forEach((element) => {
          if (processed.has(element)) {
            return;
          }
          processed.add(element);
          const node = $(element);
          const text = node.text().replace(/\s+/g, ' ').trim();
          if (text.length < 80) {
            return;
          }
          const html = $.html(element);
          if (!html) {
            return;
          }

          let score = this.scoreContentCandidate(node, text.length, selector);
          score += priority * 150;
          if (node.is('[role="main"]') || node.parents('main, [role="main"]').length > 0) {
            score += 120;
          }
          const headingCount = node.find('h1, h2').length;
          if (headingCount > 0) {
            score += headingCount * 25;
          }
          const depthPenalty = Math.min(node.parents().length, 8) * 4;
          score -= depthPenalty;

          if (!best || score > best.score) {
            best = { html, score };
          }
        });
    });

    return best?.html;
  }

  private autoDetectContentHtml($: cheerio.CheerioAPI): string | undefined {
    type Candidate = { html: string; length: number; selector: string; score: number };
    let best: Candidate | undefined;

    const evaluateElements = (selector: string, elements: AnyNode[]) => {
      elements.forEach((element, index) => {
        const node = $(element);
        const text = node.text().replace(/\s+/g, ' ').trim();
        const length = text.length;
        if (length < 80) {
          return;
        }
        const html = node.html();
        if (!html) {
          return;
        }
        const score = this.scoreContentCandidate(node, length, selector);
        const suffix = elements.length > 1 ? `#${index}` : '';
        const candidate = { html, length, selector: `${selector}${suffix}`, score };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      });
    };

    SMART_CONTENT_CANDIDATES.forEach((selector) => {
      const nodes = $(selector).toArray();
      if (nodes.length > 0) {
        evaluateElements(selector, nodes);
      }
    });

    if (!best) {
      const keywordNodes = $('div, section')
        .filter((_, element) => {
          const id = ($(element).attr('id') ?? '').toLowerCase();
          const classes = ($(element).attr('class') ?? '').toLowerCase();
          return ['content', 'article', 'doc', 'markdown', 'page'].some(
            (token) => id.includes(token) || classes.includes(token)
          );
        })
        .toArray();
      if (keywordNodes.length > 0) {
        evaluateElements('auto-content', keywordNodes);
      }
    }

    if (best) {
      this.logger.debug(`DocsPlugin auto-detected content using selector hint "${best.selector}".`);
      return best.html;
    }
    return undefined;
  }

  private scoreContentCandidate(
    node: cheerio.Cheerio<AnyNode>,
    textLength: number,
    selectorHint: string
  ): number {
    let score = textLength;

    const paragraphCount = node.find('p').length;
    const headingCount = node.find('h1, h2, h3').length;
    const codeBlocks = node.find('pre, code').length;
    score += paragraphCount * 30;
    score += headingCount * 20;
    score += Math.min(codeBlocks, 6) * 10;

    const anchorNodes = node.find('a');
    const anchorCount = anchorNodes.length;
    const anchorTextLength = anchorNodes.text().replace(/\s+/g, ' ').trim().length;
    const linkDensity = textLength > 0 ? anchorTextLength / textLength : 0;
    if (linkDensity > 0.6) {
      score -= (linkDensity - 0.6) * 300;
    }
    if (anchorCount > 40 && paragraphCount < 5) {
      score -= 200;
    }

    score -= this.detectNavigationPenalty(node);

    const selectorBoostTokens = ['[role="document"]', '.theme-doc-markdown', '.docMainContainer'];
    if (selectorBoostTokens.some((token) => selectorHint.includes(token))) {
      score += 80;
    }

    return score;
  }

  private detectNavigationPenalty(node: cheerio.Cheerio<AnyNode>): number {
    let penalty = 0;
    const classes = (node.attr('class') ?? '').toLowerCase();
    const id = (node.attr('id') ?? '').toLowerCase();
    const role = (node.attr('role') ?? '').toLowerCase();
    const ariaLabel = (node.attr('aria-label') ?? '').toLowerCase();

    const navTokens = ['sidebar', 'menu', 'navigation', 'breadcrumbs', 'breadcrumb', 'toc', 'tabs'];
    if (node.is('nav') || role === 'navigation') {
      penalty += 250;
    }
    if (navTokens.some((token) => classes.includes(token) || id.includes(token) || ariaLabel.includes(token))) {
      penalty += 150;
    }
    if (node.parents('nav, [role="navigation"], .sidebar, .menu, .toc').length > 0) {
      penalty += 100;
    }

    const listCount = node.find('ul, ol').length;
    const paragraphCount = node.find('p').length;
    if (listCount > paragraphCount * 3 && paragraphCount < 4) {
      penalty += 120;
    }

    const anchorCount = node.find('a').length;
    if (anchorCount > 80) {
      penalty += 80;
    }

    return penalty;
  }

  private ensureHeadingAnchors($: cheerio.CheerioAPI, selectors: string[]): void {
    const normalizedSelectors = selectors.map((selector) => selector?.trim()).filter(Boolean);
    if (!normalizedSelectors.length) {
      return;
    }
    const combinedSelector = normalizedSelectors.join(', ');
    const usedAnchors = new Set<string>();
    $(combinedSelector)
      .toArray()
      .forEach((element) => {
        const node = $(element);
        const text = node.text().replace(/\s+/g, ' ').trim();
        if (!text) {
          return;
        }
        const existing = this.resolveHeadingAnchor(node);
        if (existing) {
          usedAnchors.add(existing);
          return;
        }
        const base = this.slugify(text);
        if (!base) {
          return;
        }
        let candidate = base;
        let suffix = 2;
        while (usedAnchors.has(candidate)) {
          candidate = `${base}-${suffix}`;
          suffix += 1;
        }
        node.attr('id', candidate);
        usedAnchors.add(candidate);
      });
  }

  private resolveHeadingAnchor(node: cheerio.Cheerio<AnyNode>): string | undefined {
    const direct = node.attr('id')?.trim();
    if (direct) {
      return direct;
    }
    const descendantWithId = node.find('[id]').attr('id')?.trim();
    if (descendantWithId) {
      return descendantWithId;
    }
    const hashLink = node.find('a[href^="#"]').attr('href');
    if (hashLink) {
      const normalized = hashLink.replace(/^#/, '').trim();
      if (normalized) {
        return normalized;
      }
    }
    return undefined;
  }

  private collectHeadings(
    $: cheerio.CheerioAPI,
    selectors: string[]
  ): Array<{ text: string; anchor: string }> {
    const headings: Array<{ text: string; anchor: string }> = [];
    const normalizedSelectors = selectors.map((selector) => selector?.trim()).filter(Boolean);
    if (!normalizedSelectors.length) {
      return headings;
    }

    const combinedSelector = normalizedSelectors.join(', ');
    $(combinedSelector)
      .toArray()
      .forEach((element) => {
          const node = $(element);
          const text = node.text().replace(/\s+/g, ' ').trim();
          if (!text) {
            return;
          }
        const anchor = this.resolveHeadingAnchor(node) ?? this.slugify(text);
        if (!anchor) {
          return;
        }
        headings.push({ text, anchor });
      });
    return headings;
  }

  private sanitizeTitle(title: string): string {
    const normalized = title.replace(/¶/g, '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return title.trim();
    }

    const segments = normalized
      .split(/\s*[–—\-|•·]\s*/)
      .map((segment) =>
        segment
          .replace(/\s*\((?:latest|current|stable)\)\s*$/i, '')
          .replace(/\s*\b(?:documentation|docs)\b\s*$/i, '')
          .trim()
      )
      .filter(Boolean);
    if (segments.length <= 1) {
      return normalized;
    }

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const segment of segments) {
      const key = segment.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(segment);
      }
    }

    return deduped.join(' — ');
  }

  private trimCommonTitleSuffix(artifacts: NormalizedArtifact[]): string | undefined {
    if (artifacts.length < 2) {
      return undefined;
    }

    const tokenized = artifacts.map((artifact) =>
      artifact.displayName
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
    );

    const suffixTokens: string[] = [];
    let offset = 1;

    while (true) {
      let candidate: string | undefined;
      for (const tokens of tokenized) {
        const index = tokens.length - offset;
        if (index < 0) {
          candidate = undefined;
          break;
        }
        const token = tokens[index];
        if (!candidate) {
          candidate = token.toLowerCase();
        } else if (candidate !== token.toLowerCase()) {
          candidate = undefined;
          break;
        }
      }

      if (!candidate) {
        break;
      }

      const originalToken = tokenized[0][tokenized[0].length - offset];
      suffixTokens.unshift(originalToken);
      offset += 1;
    }

    const suffix = suffixTokens.join(' ').trim();
    if (!suffix || suffix.length < 6) {
      return undefined;
    }

    const suffixRegex = new RegExp(`\\s*${this.escapeRegExp(suffix)}\\s*$`, 'i');
    artifacts.forEach((artifact) => {
      artifact.displayName = artifact.displayName.replace(suffixRegex, '').trim();
    });

    return suffix;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private detectPackageVersion(
    $: cheerio.CheerioAPI,
    title?: string,
    descriptorLabel?: string
  ): string | undefined {
    type VersionCandidate = { value: string; confidence: number };
    const candidates: VersionCandidate[] = [];

    const addCandidate = (value: string | undefined, confidence: number) => {
      const normalized = value?.trim();
      if (!normalized || !this.looksLikeVersion(normalized)) {
        return;
      }
      candidates.push({ value: normalized, confidence });
    };

    VERSION_META_SELECTORS.forEach((selector) => {
      addCandidate($(selector).attr('content'), 4);
    });

    VERSION_SELECTOR_HINTS.forEach((selector) => {
      const node = $(selector).first();
      if (!node || node.length === 0) {
        return;
      }
      addCandidate(this.readVersionAttribute(node), 4);
      addCandidate(this.extractVersionFromText(node.text()), 3);
    });

    const keywordNodes = $('body *')
      .toArray()
      .filter((element) => {
        const text = $(element).text().replace(/\s+/g, ' ').trim();
        if (!text || text.length > 120) {
          return false;
        }
        const lower = text.toLowerCase();
        return VERSION_TEXT_KEYWORDS.some((keyword) => lower.includes(keyword));
      });

    for (const element of keywordNodes) {
      addCandidate(this.extractVersionFromText($(element).text()), 2);
    }

    if (title) {
      addCandidate(this.extractVersionFromText(title), 3);
    }

    const primaryHeading = $('h1').first().text();
    if (primaryHeading) {
      addCandidate(this.extractVersionFromText(primaryHeading), 3);
    }

    const descriptorCandidate = descriptorLabel && descriptorLabel.toLowerCase() !== 'latest'
      ? descriptorLabel
      : undefined;
    addCandidate(descriptorCandidate, 1);

    candidates.sort((a, b) => {
      if (b.confidence === a.confidence) {
        return b.value.length - a.value.length;
      }
      return b.confidence - a.confidence;
    });

    return candidates[0]?.value;
  }

  private readVersionAttribute(node: cheerio.Cheerio<AnyNode>): string | undefined {
    for (const attr of VERSION_ATTRIBUTE_HINTS) {
      const value = node.attr(attr)?.trim();
      if (value && this.looksLikeVersion(value)) {
        return value;
      }
    }
    return undefined;
  }

  private extractVersionFromText(text?: string): string | undefined {
    if (!text) {
      return undefined;
    }
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return undefined;
    }
    const explicitMatch = normalized.match(/(?:documentation|docs|package)\s*version\s*[:\-]?\s*([A-Za-z0-9.\-_]+)/i);
    if (explicitMatch?.[1]) {
      return explicitMatch[1];
    }
    const fallbackMatch = normalized.match(/v?(\d+(?:\.\d+){1,3})/i);
    if (fallbackMatch?.[1]) {
      return fallbackMatch[1];
    }
    return undefined;
  }

  private looksLikeVersion(value: string): boolean {
    return /[0-9]/.test(value);
  }

  private extractTimestamp(headers: RawAxiosResponseHeaders): string {
    const headerValue = this.getHeader(headers, 'last-modified') ?? this.getHeader(headers, 'date');
    const date = headerValue ? new Date(headerValue) : new Date();
    return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
  }

  private getHeader(headers: RawAxiosResponseHeaders, name: string): string | undefined {
    const bag = headers as Record<string, string | string[] | undefined>;
    const direct = bag[name] ?? bag[name.toLowerCase()];
    if (Array.isArray(direct)) {
      return direct[0];
    }
    return direct;
  }

  private normalizeRelativePath(path: string): string {
    const sanitized = path.startsWith('/') ? path : `/${path}`;
    const cleaned = sanitized.split('?')[0].split('#')[0] || '/';
    return cleaned === '/' ? '' : cleaned.replace(/\/+$/, '');
  }

  private buildPageUrl(version: DocsVersion, relativePath: string): string {
    const sanitized = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return `${version.rootUrl}${sanitized}`;
  }

  private buildVersionDescriptor(options: NormalizedDocsOptions, label: string, path: string): DocsVersion {
    const trimmedLabel = label.trim();
    const normalizedLabel = trimmedLabel.length > 0 ? trimmedLabel : 'docs';
    const rootUrl = this.resolveVersionRoot(options.baseUrl, path);
    return {
      key: this.slugify(normalizedLabel),
      label: normalizedLabel,
      rootUrl
    };
  }

  private getVersionBasePath(version: DocsVersion): string {
    try {
      const parsed = new URL(version.rootUrl);
      const pathname = parsed.pathname || '/';
      return pathname.endsWith('/') ? pathname : `${pathname}/`;
    } catch {
      return '/';
    }
  }

  private resolveVersionRoot(baseUrl: string, rawPath: string): string {
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const cleanedPath = rawPath.trim();
    if (!cleanedPath || cleanedPath === '/' || cleanedPath === '.') {
      return normalizedBase;
    }
    try {
      const resolved = new URL(cleanedPath, normalizedBase);
      const normalized = resolved.toString();
      return normalized.endsWith('/') ? normalized : `${normalized}/`;
    } catch {
      const stripped = cleanedPath.replace(/^\/+/, '');
      const fallback = `${normalizedBase}${stripped}`;
      return fallback.endsWith('/') ? fallback : `${fallback}/`;
    }
  }

  private fetchDocument(
    http: AxiosInstance,
    url: string
  ): Promise<{ html: string; headers: RawAxiosResponseHeaders } | null> {
    return http
      .get<string>(url, { responseType: 'text' })
      .then((response) => ({
        html: response.data,
        headers: response.headers as RawAxiosResponseHeaders
      }))
      .catch((error) => {
        this.logger.debug(`DocsPlugin failed to fetch ${url}: ${error instanceof Error ? error.message : error}`);
        return null;
      });
  }

  private buildExternalId(versionKey: string, path: string): string {
    const normalized = path === '/' ? 'index' : path.replace(/^\//, '').replace(/\//g, '_');
    return `${versionKey}:${normalized}`;
  }

  private slugify(value: string): string {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return slug || 'docs';
  }

  private versionLabelToSlug(label: string): string | null {
    const cleaned = label.trim();
    if (!cleaned || cleaned.toLowerCase() === 'latest') {
      return null;
    }
    const normalized = cleaned.replace(/^v/i, '');
    const slug = normalized.replace(/[^a-zA-Z0-9.-]/g, '');
    return slug || null;
  }

  private combinePaths(...parts: string[]): string {
    const segments = parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => part.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean);
    if (segments.length === 0) {
      return '/';
    }
    return `/${segments.join('/')}/`;
  }
}
