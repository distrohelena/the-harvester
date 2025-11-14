import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios, { AxiosInstance, RawAxiosResponseHeaders } from 'axios';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { Plugin, PluginNavigationPayload, NormalizedArtifact } from '../interfaces.js';
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
}

interface DocsVersion {
  key: string;
  label: string;
  rootUrl: string;
  origin: string;
  basePath: string;
}

const DEFAULT_CONTENT_SELECTORS = ['article', 'main', '#content'];
const DEFAULT_TITLE_SELECTORS = ['h1', 'title'];
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

  async extract(source: SourceEntity): Promise<NormalizedArtifact[]> {
    const options = this.normalizeOptions(source.options as DocsPluginOptions);
    const http = axios.create({
      headers: {
        'User-Agent': options.userAgent,
        Accept: 'text/html,application/xhtml+xml'
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const versions = await this.resolveVersions(options, http);
    if (versions.length === 0) {
      this.logger.warn(`No documentation versions discovered for source ${source.id}.`);
      return [];
    }

    const artifacts: NormalizedArtifact[] = [];
    for (const version of versions) {
      const versionArtifacts = await this.crawlVersion(version, options, http);
      artifacts.push(...versionArtifacts);
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

    const maxPages = raw.maxPages && Number.isFinite(raw.maxPages)
      ? Math.min(Math.max(Number(raw.maxPages), 1), 500)
      : 50;

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
      userAgent: raw.userAgent?.trim() || 'ArtifactHarvesterDocs/1.0'
    };
  }

  private async resolveVersions(options: NormalizedDocsOptions, http: AxiosInstance): Promise<DocsVersion[]> {
    const manual = this.parseManualVersions(options);
    if (manual.length > 0) {
      return manual;
    }

    if (options.versionSelector) {
      const indexUrl = new URL(options.versionIndexPath || '/', options.baseUrl).toString();
      const document = await this.fetchDocument(http, indexUrl);
      if (document) {
        const versions = this.scrapeVersionsFromDocument(document.html, options);
        if (versions.length > 0) {
          return versions;
        }
      }
    }

    return [this.buildVersionDescriptor(options, 'latest', '/')];
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

      const url = this.buildPageUrl(version, nextPath);
      const document = await this.fetchDocument(http, url);
      if (!document) {
        continue;
      }

      const $ = cheerio.load(document.html);
      const artifact = this.buildArtifact(version, nextPath, $, url, document.headers, options);
      if (artifact) {
        artifacts.push(artifact);
      }

      if (artifacts.length >= options.maxPages) {
        break;
      }

      const links = this.extractLinks(version, $, options.followSelector);
      for (const link of links) {
        if (!visited.has(link) && queue.length < options.maxPages * 3) {
          queue.push(link);
        }
      }
    }

    this.logger.debug(
      `DocsPlugin crawled ${artifacts.length} page(s) for ${version.label} (${version.basePath}).`
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
    const title = this.pickFirstText($, options.titleSelectors) || 'Untitled';
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
      versionBasePath: version.basePath
    };
    const packageVersion = this.detectPackageVersion($);
    if (packageVersion) {
      metadata.packageVersion = packageVersion;
    }

    return {
      externalId: this.buildExternalId(version.key, path),
      displayName: `${title} (${version.label})`,
      version: version.label,
      data: {
        path,
        version: version.label,
        title,
        html,
        text,
        headings
      },
      metadata,
      originalUrl: url,
      timestamp
    };
  }

  private extractLinks(version: DocsVersion, $: cheerio.CheerioAPI, selector: string): string[] {
    const links = new Set<string>();
    $(selector)
      .toArray()
      .forEach((element) => {
        const href = $(element).attr('href');
        if (!href || href.startsWith('#')) {
          return;
        }
        const normalized = this.normalizeLink(version, href);
        if (normalized) {
          links.add(normalized);
        }
      });
    return Array.from(links);
  }

  private normalizeLink(version: DocsVersion, href: string): string | null {
    try {
      const absolute = new URL(href, version.rootUrl);
      if (absolute.origin !== version.origin) {
        return null;
      }
      const basePath = version.basePath;
      const candidatePath = absolute.pathname.endsWith('/')
        ? absolute.pathname
        : `${absolute.pathname}/`;
      if (!candidatePath.startsWith(basePath)) {
        return null;
      }
      const remainder = candidatePath.slice(basePath.length).replace(/\/$/, '');
      const normalized = remainder ? `/${remainder}` : '/';
      return normalized;
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
    const explicit = this.pickFirstHtml($, options.contentSelectors);
    if (explicit) {
      return explicit;
    }
    return this.autoDetectContentHtml($);
  }

  private autoDetectContentHtml($: cheerio.CheerioAPI): string | undefined {
    type Candidate = { html: string; length: number; selector: string };
    let best: Candidate | undefined;

    const evaluateElements = (selector: string, elements: AnyNode[]) => {
      elements.forEach((element, index) => {
        const text = $(element).text().replace(/\s+/g, ' ').trim();
        const length = text.length;
        if (length < 80) {
          return;
        }
        const html = $(element).html();
        if (!html) {
          return;
        }
        if (!best || length > best.length) {
          const suffix = elements.length > 1 ? `#${index}` : '';
          best = { html, length, selector: `${selector}${suffix}` };
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

  private collectHeadings($: cheerio.CheerioAPI, selectors: string[]): string[] {
    const headings: string[] = [];
    selectors.forEach((selector) => {
      $(selector)
        .toArray()
        .forEach((element) => {
          const text = $(element).text().trim();
          if (text) {
            headings.push(text);
          }
        });
    });
    return headings;
  }

  private detectPackageVersion($: cheerio.CheerioAPI): string | undefined {
    for (const selector of VERSION_SELECTOR_HINTS) {
      const node = $(selector).first();
      if (!node || node.length === 0) {
        continue;
      }
      const attrValue = this.readVersionAttribute(node);
      if (attrValue) {
        return attrValue;
      }
      const textValue = this.extractVersionFromText(node.text());
      if (textValue) {
        return textValue;
      }
    }

    const keywordNodes = $('body *')
      .toArray()
      .filter((element) => {
        const text = $(element).text().replace(/\s+/g, ' ').trim();
        if (!text || text.length > 80) {
          return false;
        }
        const lower = text.toLowerCase();
        return VERSION_TEXT_KEYWORDS.some((keyword) => lower.includes(keyword));
      });

    for (const element of keywordNodes) {
      const textValue = this.extractVersionFromText($(element).text());
      if (textValue) {
        return textValue;
      }
    }

    return undefined;
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
    try {
      const url = new URL(path, 'https://placeholder.local');
      const cleaned = url.pathname.replace(/\/+/g, '/');
      return cleaned || '/';
    } catch {
      const sanitized = path.startsWith('/') ? path : `/${path}`;
      return sanitized.split('?')[0].split('#')[0] || '/';
    }
  }

  private buildPageUrl(version: DocsVersion, relativePath: string): string {
    const sanitized = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return new URL(sanitized || '', version.rootUrl).toString();
  }

  private buildVersionDescriptor(
    options: NormalizedDocsOptions,
    label: string,
    path: string
  ): DocsVersion {
    const rootUrl = new URL(path || '/', options.baseUrl);
    let normalizedUrl = rootUrl.toString();
    if (!normalizedUrl.endsWith('/')) {
      normalizedUrl = `${normalizedUrl}/`;
    }
    const pathname = rootUrl.pathname.endsWith('/') ? rootUrl.pathname : `${rootUrl.pathname}/`;
    const origin = `${rootUrl.protocol}//${rootUrl.host}`;
    return {
      key: this.slugify(label || pathname || 'docs'),
      label: label || pathname || 'docs',
      rootUrl: normalizedUrl,
      origin,
      basePath: pathname
    };
  }

  private fetchDocument(
    http: AxiosInstance,
    url: string
  ): Promise<{ html: string; headers: RawAxiosResponseHeaders } | null> {
    return http
      .get<string>(url, { responseType: 'text' })
      .then((response) => ({ html: response.data, headers: response.headers }))
      .catch((error) => {
        this.logger.warn(`DocsPlugin failed to fetch ${url}: ${error?.message ?? error}`);
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
}
