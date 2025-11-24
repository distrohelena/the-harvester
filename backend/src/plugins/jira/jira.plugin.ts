import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Plugin,
  PluginNavigationPayload,
  NormalizedArtifact,
  PluginExtractContext
} from '../interfaces.js';
import { SourceEntity } from '../../sources/source.entity.js';
import { ArtifactEntity } from '../../artifacts/artifact.entity.js';

interface JiraPluginOptions {
  siteUrl?: string;
  email?: string;
  apiToken?: string;
  recentItems?: number;
  includedProjects?: string;
}

interface NormalizedJiraOptions {
  baseUrl: string;
  authHeader: string;
  recentItems?: number;
  includedProjects?: string[];
}

interface JiraProject {
  id?: string;
  key?: string;
  name?: string;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, any>;
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  total?: number;
  nextPageToken?: string | null;
  isLast?: boolean;
}

const API_VERSIONS = ['3', 'latest', '2'] as const;
const SEARCH_RESOURCES = ['search/jql', 'search', 'jql/search', 'issue/search'] as const;
const PROJECT_RESOURCES = ['project/search', 'project'] as const;
const DEFAULT_FIELDS = [
  'summary',
  'description',
  'issuetype',
  'status',
  'priority',
  'assignee',
  'reporter',
  'labels',
  'components',
  'comment',
  'project',
  'created',
  'updated',
  'duedate'
];

@Injectable()
export class JiraPlugin implements Plugin {
  private readonly logger = new Logger(JiraPlugin.name);

  constructor(
    @InjectRepository(ArtifactEntity)
    private readonly artifactsRepository: Repository<ArtifactEntity>
  ) {}

  readonly descriptor = {
    key: 'jira',
    name: 'Jira Issues',
    optionsSchema: {
      fields: [
        { name: 'siteUrl', label: 'Site URL', type: 'string', required: true },
        { name: 'email', label: 'User Email', type: 'string', required: true },
        {
          name: 'apiToken',
          label: 'API Token',
          type: 'string',
          required: true,
          inputType: 'password'
        },
        {
          name: 'recentItems',
          label: 'Recent Items',
          type: 'number',
          description: 'Leave blank to fetch all issues; set a number to limit how many recent issues are fetched per project'
        },
        {
          name: 'includedProjects',
          label: 'Projects Included',
          type: 'string',
          description: 'Restrict to these project keys (one per line); leave blank to include all'
        }
      ]
    },
    artifactSchema: {
      fields: [
        { name: 'key', label: 'Issue Key', type: 'string', required: true },
        { name: 'summary', label: 'Summary', type: 'string', required: true },
        { name: 'description', label: 'Description', type: 'string' },
        { name: 'status', label: 'Status', type: 'string' },
        { name: 'issueType', label: 'Issue Type', type: 'string' },
        { name: 'priority', label: 'Priority', type: 'string' },
        { name: 'assignee', label: 'Assignee', type: 'object' },
        { name: 'reporter', label: 'Reporter', type: 'object' },
        { name: 'labels', label: 'Labels', type: 'array' },
        { name: 'components', label: 'Components', type: 'array' },
        { name: 'project', label: 'Project', type: 'object' },
        { name: 'url', label: 'Jira URL', type: 'string' },
        { name: 'createdAt', label: 'Created At', type: 'string' },
        { name: 'updatedAt', label: 'Updated At', type: 'string' }
      ]
    },
    navigationSchema: {
      type: 'tree',
      label: 'Jira Projects'
    }
  } as const;

  async extract(
    source: SourceEntity,
    context?: PluginExtractContext
  ): Promise<NormalizedArtifact[] | void> {
    const options = this.normalizeOptions(source.options as JiraPluginOptions);
    const projects = await this.fetchAllProjects(options);
    if (!projects.length) {
      this.logger.warn('Jira plugin did not find accessible projects for %s', options.baseUrl);
      return context?.emitBatch ? undefined : [];
    }

    const artifacts: NormalizedArtifact[] = [];
    const emitBatch = async (batch: NormalizedArtifact[]) => {
      if (!batch.length) return;
      if (context?.emitBatch) {
        await context.emitBatch(batch);
      } else {
        artifacts.push(...batch);
      }
    };

    for (const project of projects) {
      const issues = await this.collectIssuesForProject(options, project);
      const projectArtifacts = issues.map((issue) => this.buildArtifact(issue, project, options.baseUrl));
      if (projectArtifacts.length) {
        await emitBatch(projectArtifacts);
      }
    }

    if (context?.emitBatch) {
      return;
    }
    return artifacts;
  }

  async buildNavigation(sourceId: string): Promise<PluginNavigationPayload> {
    const artifacts = await this.artifactsRepository
      .createQueryBuilder('artifact')
      .leftJoin('artifact.source', 'source')
      .leftJoinAndSelect('artifact.lastVersion', 'lastVersion')
      .where('source.id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'jira' })
      .orderBy('artifact.updatedAt', 'DESC')
      .take(500)
      .getMany();

    const projects = new Map<
      string,
      {
        id: string;
        label: string;
        statuses: Map<string, { id: string; label: string; issues: any[] }>;
      }
    >();

    artifacts.forEach((artifact) => {
      const metadata = (artifact.lastVersion?.metadata ?? {}) as Record<string, any>;
      const data = (artifact.lastVersion?.data ?? {}) as Record<string, any>;
      const projectKey = metadata.projectKey ?? 'Unknown';
      const projectName = metadata.projectName ? `${projectKey} – ${metadata.projectName}` : projectKey;
      const status = metadata.status ?? 'Uncategorized';
      const issueUpdatedAt = this.resolveIssueTimestamp(data, artifact);
      const normalizedTimestamp =
        typeof issueUpdatedAt === 'number' && Number.isFinite(issueUpdatedAt) ? issueUpdatedAt : 0;

      if (!projects.has(projectKey)) {
        projects.set(projectKey, {
          id: `project-${projectKey}`,
          label: projectName,
          statuses: new Map()
        });
      }
      const projectNode = projects.get(projectKey)!;
      if (!projectNode.statuses.has(status)) {
        projectNode.statuses.set(status, {
          id: `${projectNode.id}-${status}`,
          label: status,
          issues: []
        });
      }
      const statusNode = projectNode.statuses.get(status)!;
      statusNode.issues.push({
        id: artifact.id,
        label: `${metadata.issueKey ?? artifact.displayName}`,
        updatedAt: normalizedTimestamp,
        data: { artifactId: artifact.id, issueKey: metadata.issueKey }
      });
    });

    const nodes = Array.from(projects.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((project) => ({
        id: project.id,
        label: project.label,
        children: Array.from(project.statuses.values())
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((status) => ({
            id: status.id,
            label: status.label,
            children: status.issues.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
          }))
      }));

    return { nodes };
  }

  private normalizeOptions(raw: JiraPluginOptions): NormalizedJiraOptions {
    if (!raw?.siteUrl?.trim() || !raw?.email?.trim() || !raw?.apiToken?.trim()) {
      throw new BadRequestException('Jira plugin requires siteUrl, email, and apiToken.');
    }
    const baseUrl = this.normalizeBaseUrl(raw.siteUrl);
    const encoded = Buffer.from(`${raw.email.trim()}:${raw.apiToken.trim()}`).toString('base64');
    const parsedRecent =
      raw.recentItems === undefined || raw.recentItems === null
        ? NaN
        : typeof raw.recentItems === 'number'
        ? raw.recentItems
        : Number.parseInt(String(raw.recentItems), 10);
    const recentItems =
      Number.isFinite(parsedRecent) && parsedRecent > 0 ? parsedRecent : undefined;
    const includedProjects = Array.isArray(raw.includedProjects)
      ? raw.includedProjects
      : typeof raw.includedProjects === 'string'
      ? raw.includedProjects
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : undefined;
    return {
      baseUrl,
      authHeader: `Basic ${encoded}`,
      recentItems,
      includedProjects: includedProjects?.length ? includedProjects : undefined
    };
  }

  private normalizeBaseUrl(input: string): string {
    let normalized = input.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }
    normalized = normalized.replace(/\/+$/, '');
    normalized = normalized.replace(/\/rest\/api\/?.*$/i, '');
    return normalized;
  }

  private async fetchAllProjects(options: NormalizedJiraOptions): Promise<JiraProject[]> {
    const endpoints = this.buildEndpoints(options.baseUrl, PROJECT_RESOURCES);
    let lastError: unknown;
    for (const endpoint of endpoints) {
      try {
        const aggregated: JiraProject[] = [];
        let startAt = 0;
        const maxResults = 50;
        let keepGoing = true;

        while (keepGoing) {
          const response = await axios.get(endpoint, {
            params: {
              startAt,
              maxResults,
              orderBy: 'name',
              status: 'live'
            },
            ...this.requestConfig(options)
          });

          const values = Array.isArray(response.data?.values)
            ? response.data.values
            : Array.isArray(response.data)
            ? response.data
            : [];
          aggregated.push(...values);

          const total =
            typeof response.data?.total === 'number' ? response.data.total : undefined;
          if (values.length < maxResults || (total && aggregated.length >= total)) {
            keepGoing = false;
          } else {
            startAt += values.length;
          }
        }

        if (aggregated.length) {
          const filtered =
            options.includedProjects && options.includedProjects.length
              ? aggregated.filter((project) => {
                  const key = project.key ?? project.id ?? '';
                  return key
                    ? options.includedProjects!.some(
                        (allowed) => allowed.toLowerCase() === String(key).toLowerCase()
                      )
                    : false;
                })
              : aggregated;
          if (filtered.length) {
            return filtered;
          }
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      this.logger.error('Failed to fetch Jira projects', lastError as any);
    }
    return [];
  }

  private async collectIssuesForProject(
    options: NormalizedJiraOptions,
    project: JiraProject
  ): Promise<JiraIssue[]> {
    const projectKey = project.key || project.id;
    if (!projectKey) {
      return [];
    }

    const pageSize = 50;
    const maxIssues =
      typeof options.recentItems === 'number' && Number.isFinite(options.recentItems)
        ? Math.max(options.recentItems, 1)
        : undefined;
    const aggregated: JiraIssue[] = [];
    let startAt = 0;
    let nextPageToken: string | undefined;
    let hasMore = true;

    while (hasMore && (maxIssues === undefined || aggregated.length < maxIssues)) {
      // Escape user-provided project keys so Jira does not reject queries that contain backslashes or quotes.
      const safeProjectKey = this.escapeJqlLiteral(projectKey);
      const page = await this.searchIssues(
        options,
        `project = "${safeProjectKey}" ORDER BY updated DESC`,
        startAt,
        pageSize,
        nextPageToken
      );
      if (!page.issues.length) {
        break;
      }
      aggregated.push(...page.issues);
      startAt += page.issues.length;
      nextPageToken =
        typeof page.nextPageToken === 'string' && page.nextPageToken.length
          ? page.nextPageToken
          : undefined;

      if (typeof page.total === 'number') {
        hasMore = startAt < page.total;
      } else if (nextPageToken) {
        hasMore = true;
      } else if (page.isLast === false) {
        hasMore = true;
      } else {
        hasMore = false;
      }
      if (maxIssues !== undefined && aggregated.length >= maxIssues) {
        break;
      }
    }

    return maxIssues === undefined ? aggregated : aggregated.slice(0, maxIssues);
  }

  private async searchIssues(
    options: NormalizedJiraOptions,
    jql: string,
    startAt: number,
    maxResults: number,
    nextPageToken?: string
  ): Promise<JiraSearchResponse> {
    const endpoints = this.buildEndpoints(options.baseUrl, SEARCH_RESOURCES);
    const basePayload = {
      jql,
      maxResults,
      fields: DEFAULT_FIELDS,
      fieldsByKeys: false
    };

    let lastError: unknown;
    for (const endpoint of endpoints) {
      const isJqlSearch = /\/search\/jql$/i.test(endpoint);
      const supportsGet = !isJqlSearch;
      const postPayload = isJqlSearch
        ? {
            ...basePayload,
            ...(nextPageToken ? { nextPageToken } : {})
          }
        : {
            ...basePayload,
            startAt
          };
      try {
        this.logger.debug(
          `JiraPlugin search POST ${endpoint} (startAt=${startAt}, maxResults=${maxResults})`
        );
        const response = await axios.post(endpoint, postPayload, this.requestConfig(options));
        const normalized = this.normalizeSearchResponse(response.data);
        this.logger.debug(
          `JiraPlugin search POST succeeded for ${endpoint} with ${normalized.issues.length} issue(s)`
        );
        return normalized;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `JiraPlugin search POST failed for ${endpoint}: ${this.formatAxiosError(error, 'POST error')}`
        );
        if (!supportsGet || !this.shouldFallbackToGet(error)) {
          continue;
        }
        try {
          this.logger.debug(
            `JiraPlugin search GET fallback ${endpoint} (startAt=${startAt}, maxResults=${maxResults})`
          );
          const response = await axios.get(endpoint, {
            params: {
              jql,
              startAt,
              maxResults,
              fields: DEFAULT_FIELDS.join(',')
            },
            ...this.requestConfig(options)
          });
          const normalized = this.normalizeSearchResponse(response.data);
          this.logger.debug(
            `JiraPlugin search GET succeeded for ${endpoint} with ${normalized.issues.length} issue(s)`
          );
          return normalized;
        } catch (getError) {
          lastError = getError;
          this.logger.warn(
            `JiraPlugin search GET failed for ${endpoint}: ${this.formatAxiosError(getError, 'GET error')}`
          );
        }
      }
    }

    throw new BadRequestException(this.formatAxiosError(lastError, 'Jira search failed'));
  }

  private normalizeSearchResponse(payload: any): JiraSearchResponse {
    if (Array.isArray(payload?.issues)) {
      return {
        issues: payload.issues,
        total: typeof payload.total === 'number' ? payload.total : undefined,
        nextPageToken:
          typeof payload.nextPageToken === 'string' ? payload.nextPageToken : undefined,
        isLast: typeof payload.isLast === 'boolean' ? payload.isLast : undefined
      };
    }
    if (Array.isArray(payload?.responses) && payload.responses.length) {
      const firstResponse = payload.responses[0];
      const issues = Array.isArray(firstResponse?.issues) ? firstResponse.issues : [];
      const total =
        typeof firstResponse?.total === 'number' ? firstResponse.total : undefined;
      return {
        issues,
        total,
        nextPageToken:
          typeof firstResponse?.nextPageToken === 'string'
            ? firstResponse.nextPageToken
            : undefined,
        isLast: typeof firstResponse?.isLast === 'boolean' ? firstResponse.isLast : undefined
      };
    }
    const first = payload?.results?.[0];
    const issues = Array.isArray(first?.issues) ? first.issues : [];
    const total = typeof first?.total === 'number' ? first.total : undefined;
    return {
      issues,
      total,
      nextPageToken:
        typeof first?.nextPageToken === 'string' ? first.nextPageToken : undefined,
      isLast: typeof first?.isLast === 'boolean' ? first.isLast : undefined
    };
  }

  private buildArtifact(issue: JiraIssue, project: JiraProject, baseUrl: string): NormalizedArtifact {
    const fields = issue.fields ?? {};
    const summary = fields.summary ?? issue.key;
    const status = fields.status?.name ?? fields.status;
    const issueType = fields.issuetype?.name ?? fields.issuetype;
    const projectKey = project.key ?? fields.project?.key;
    const projectName = project.name ?? fields.project?.name;
    const url = `${baseUrl}/browse/${issue.key}`;
    const comments = this.extractComments(fields.comment);

    const displayName = this.truncateString(`${issue.key}: ${summary}`, 255);

    return {
      externalId: issue.id,
      displayName,
      version: fields.updated ? `${issue.id}:${fields.updated}` : issue.id,
      data: {
        key: issue.key,
        summary,
        description: this.extractDescription(fields.description),
        descriptionRichText:
          fields.description && typeof fields.description === 'object'
            ? fields.description
            : undefined,
        status,
        issueType,
        priority: fields.priority?.name ?? fields.priority,
        assignee: fields.assignee
          ? {
              displayName: fields.assignee.displayName ?? fields.assignee.name,
              accountId: fields.assignee.accountId
            }
          : undefined,
        reporter: fields.reporter
          ? {
              displayName: fields.reporter.displayName ?? fields.reporter.name,
              accountId: fields.reporter.accountId
            }
          : undefined,
        labels: Array.isArray(fields.labels) ? fields.labels : [],
        components: Array.isArray(fields.components) ? fields.components : [],
        project: {
          id: project.id ?? fields.project?.id,
          key: projectKey,
          name: projectName ?? projectKey
        },
        comments: comments.length ? comments : undefined,
        commentCount:
          typeof fields.comment?.total === 'number' ? fields.comment.total : comments.length,
        url,
        createdAt: fields.created,
        updatedAt: fields.updated,
        dueDate: fields.duedate
      },
      metadata: {
        issueKey: issue.key,
        projectKey,
        projectName,
        status
      },
      originalUrl: url,
      timestamp: fields.updated ?? fields.created
    };
  }

  private truncateString(input: unknown, maxLength: number): string {
    if (typeof input !== 'string') {
      if (input === undefined || input === null) {
        return '';
      }
      const fallback = String(input);
      return fallback.length > maxLength ? fallback.slice(0, maxLength) : fallback;
    }
    if (maxLength <= 0) {
      return '';
    }
    return input.length > maxLength ? input.slice(0, maxLength) : input;
  }

  private extractComments(raw: unknown): Array<Record<string, any>> {
    const commentArray = Array.isArray((raw as any)?.comments)
      ? (raw as any).comments
      : Array.isArray(raw)
      ? raw
      : [];
    const result: Array<Record<string, any>> = [];
    for (const comment of commentArray) {
      if (!comment || typeof comment !== 'object') {
        continue;
      }
      const id = comment.id ?? comment.self ?? undefined;
      const bodyRaw = typeof comment.body === 'object' ? comment.body : undefined;
      const body =
        this.extractDescription(comment.body) ??
        (typeof comment.renderedBody === 'string' ? comment.renderedBody : undefined) ??
        (typeof comment.bodyText === 'string' ? comment.bodyText : undefined);
      result.push({
        id,
        body,
        bodyRichText: bodyRaw,
        renderedBody: typeof comment.renderedBody === 'string' ? comment.renderedBody : undefined,
        author: comment.author
          ? {
              displayName: comment.author.displayName ?? comment.author.name,
              accountId: comment.author.accountId,
              emailAddress: comment.author.emailAddress,
              timeZone: comment.author.timeZone
            }
          : undefined,
        updateAuthor: comment.updateAuthor
          ? {
              displayName: comment.updateAuthor.displayName ?? comment.updateAuthor.name,
              accountId: comment.updateAuthor.accountId,
              emailAddress: comment.updateAuthor.emailAddress,
              timeZone: comment.updateAuthor.timeZone
            }
          : undefined,
        createdAt: comment.created ?? comment.createdDate,
        updatedAt: comment.updated ?? comment.updatedDate,
        visibility: comment.visibility
          ? {
              type: comment.visibility.type,
              value: comment.visibility.value,
              identifier: comment.visibility.identifier
            }
          : undefined
      });
    }
    return result;
  }

  private extractDescription(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }
    if (typeof value !== 'object') {
      return undefined;
    }
    const rendered = this.renderAdfNode(value);
    const normalized = rendered.replace(/\n{3,}/g, '\n\n').trim();
    return normalized || undefined;
  }

  private renderAdfNode(node: any): string {
    if (!node) {
      return '';
    }
    if (Array.isArray(node)) {
      return node.map((child) => this.renderAdfNode(child)).filter(Boolean).join('\n\n');
    }
    if (typeof node === 'string') {
      return node;
    }
    if (typeof node !== 'object') {
      return '';
    }

    switch (node.type) {
      case 'doc':
        return this.renderAdfNode(node.content ?? []);
      case 'paragraph':
        return this.renderAdfInline(node.content ?? []);
      case 'heading': {
        const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
        const text = this.renderAdfInline(node.content ?? []).trim();
        return text ? `${'#'.repeat(level)} ${text}` : '';
      }
      case 'blockquote': {
        const text = this.renderAdfNode(node.content ?? []);
        if (!text) return '';
        return text
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n');
      }
      case 'bulletList':
        return this.renderAdfList(node.content ?? [], false);
      case 'orderedList':
        return this.renderAdfList(node.content ?? [], true, Number(node.attrs?.order) || 1);
      case 'listItem':
        return this.renderAdfNode(node.content ?? []);
      case 'panel':
        return this.renderAdfNode(node.content ?? []);
      case 'codeBlock': {
        const text = this.renderAdfInline(node.content ?? []);
        return text ? `\`\`\`\n${text}\n\`\`\`` : '';
      }
      case 'rule':
        return '---';
      case 'table':
        return (Array.isArray(node.content) ? node.content : [])
          .map((row: any) => this.renderAdfNode(row))
          .filter(Boolean)
          .join('\n');
      case 'tableRow':
        return (Array.isArray(node.content) ? node.content : [])
          .map((cell: any) => this.renderAdfNode(cell).replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' | ');
      case 'tableCell':
      case 'tableHeader':
        return this.renderAdfNode(node.content ?? []);
      default:
        if (Array.isArray(node.content)) {
          return this.renderAdfNode(node.content);
        }
        if (typeof node.text === 'string') {
          return node.text;
        }
        if (typeof node.attrs?.text === 'string') {
          return node.attrs.text;
        }
        if (typeof node.attrs?.url === 'string') {
          return node.attrs.url;
        }
        return '';
    }
  }

  private renderAdfInline(nodes: any[]): string {
    if (!Array.isArray(nodes)) {
      return typeof nodes === 'string' ? nodes : '';
    }
    let result = '';
    for (const node of nodes) {
      if (!node) continue;
      if (typeof node === 'string') {
        result += node;
        continue;
      }
      if (typeof node !== 'object') {
        continue;
      }
      switch (node.type) {
        case 'text':
          result += this.applyAdfMarks(node.text ?? '', node.marks);
          break;
        case 'hardBreak':
          result += '\n';
          break;
        case 'emoji':
          result += node.attrs?.shortName ?? '';
          break;
        case 'mention':
          result += node.attrs?.text ?? node.attrs?.userType ?? '';
          break;
        case 'inlineCard':
          result += node.attrs?.url ?? '';
          break;
        case 'status':
          result += node.attrs?.text ?? '';
          break;
        case 'mediaSingle':
        case 'media':
          result += node.attrs?.alt ?? node.attrs?.fileName ?? '';
          break;
        default:
          if (Array.isArray(node.content)) {
            result += this.renderAdfInline(node.content);
          } else if (typeof node.text === 'string') {
            result += node.text;
          } else if (typeof node.attrs?.text === 'string') {
            result += node.attrs.text;
          } else if (typeof node.attrs?.url === 'string') {
            result += node.attrs.url;
          }
      }
    }
    return result;
  }

  private renderAdfList(items: any[], ordered: boolean, start = 1): string {
    if (!Array.isArray(items)) {
      return '';
    }
    let index = start;
    const lines: string[] = [];
    for (const item of items) {
      if (!item) continue;
      const text = this.renderAdfNode(item).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const prefix = ordered ? `${index++}. ` : '- ';
      lines.push(`${prefix}${text}`);
    }
    return lines.join('\n');
  }

  private applyAdfMarks(text: string, marks?: any[]): string {
    if (!text || !Array.isArray(marks) || !marks.length) {
      return text;
    }
    let result = text;
    for (const mark of marks) {
      if (!mark) continue;
      switch (mark.type) {
        case 'link':
          if (mark.attrs?.href) {
            result = `${result} (${mark.attrs.href})`;
          }
          break;
        case 'code':
          result = `\`${result}\``;
          break;
        case 'strong':
          result = `**${result}**`;
          break;
        case 'em':
          result = `_${result}_`;
          break;
      }
    }
    return result;
  }

  private buildEndpoints(baseUrl: string, resources: readonly string[]): string[] {
    const bases = this.expandBaseCandidates(baseUrl);
    const endpoints: string[] = [];
    const seen = new Set<string>();
    for (const candidate of bases) {
      for (const version of API_VERSIONS) {
        for (const resource of resources) {
          const endpoint = `${candidate}/rest/api/${version}/${resource}`;
          if (!seen.has(endpoint)) {
            seen.add(endpoint);
            endpoints.push(endpoint);
          }
        }
      }
    }
    return endpoints;
  }

  private expandBaseCandidates(baseUrl: string): string[] {
    const normalized = baseUrl.replace(/\/+$/, '');
    const candidates = [normalized];
    try {
      const parsed = new URL(normalized);
      const origin = parsed.origin;
      const path = parsed.pathname.replace(/\/+$/, '');
      if (path && path !== '/') {
        const segments = path.split('/').filter(Boolean);
        if (segments.length > 1) {
          const first = `${origin}/${segments[0]}`;
          if (!candidates.includes(first)) {
            candidates.push(first);
          }
        }
        if (!candidates.includes(origin)) {
          candidates.push(origin);
        }
      }
    } catch {
      // ignore invalid URLs
    }
    return candidates;
  }

  private requestConfig(options: NormalizedJiraOptions): AxiosRequestConfig {
    return {
      headers: {
        Authorization: options.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'ArtifactHarvesterJira/1.0'
      }
    };
  }

  private shouldFallbackToGet(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }
    const status = error.response?.status;
    return status === 404 || status === 405 || status === 410;
  }

  private formatAxiosError(error: unknown, prefix: string): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const dataMessage =
        error.response?.data?.message ||
        (Array.isArray(error.response?.data?.errorMessages)
          ? error.response?.data.errorMessages.join(', ')
          : undefined);
      const message = dataMessage || error.message || 'Unknown Jira error';
      return `${prefix}${status ? ` (HTTP ${status})` : ''}: ${message}`;
    }
    if (error instanceof Error) {
      return `${prefix}: ${error.message}`;
    }
    return `${prefix}: Unknown Jira error`;
  }

  private resolveIssueTimestamp(issueData: Record<string, any>, artifact: ArtifactEntity): number | undefined {
    const candidateValues: Array<unknown> = [
      issueData.updatedAt,
      issueData.updated,
      issueData.timestamp,
      issueData.createdAt,
      artifact.updatedAt,
      artifact.createdAt
    ];

    for (const value of candidateValues) {
      const parsed = this.parseDateValue(value);
      if (typeof parsed === 'number') {
        return parsed;
      }
    }
    return undefined;
  }

  private parseDateValue(input: unknown): number | undefined {
    if (input instanceof Date) {
      return input.getTime();
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      return input;
    }
    if (typeof input === 'string' && input.trim().length) {
      const parsed = Date.parse(input);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }

  /**
   * Escape Jira string literals so control characters (quotes, backslashes) do not break JQL parsing.
   * This protects against errors like "Unsupported Unicode escape sequence" when project keys include '\' characters.
   */
  private escapeJqlLiteral(input: string): string {
    const normalized = String(input ?? '');
    return normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
