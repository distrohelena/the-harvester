<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ArtifactModel, SourceModel } from '../../types/plugins';
import { fetchSources } from '../../api/sources';
import { fetchArtifacts } from '../../api/artifacts';
import { fetchNavigation, type NavigationNode } from '../../api/navigation';

interface JiraArtifactData {
  key?: string;
  summary?: string;
  description?: string;
  status?: string;
  statusCategory?: string;
  issueType?: string;
  priority?: string;
  assignee?: { displayName?: string };
  reporter?: { displayName?: string };
  labels?: string[];
  components?: string[];
  project?: { key?: string; name?: string };
  storyPoints?: number;
  sprint?: { name?: string; state?: string };
  epicKey?: string;
  fixVersions?: string[];
  resolution?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  dueDate?: string;
  comments?: Array<{ id?: string; author?: { displayName?: string }; body?: string; createdAt?: string }>;
  changelog?: Array<Record<string, any>>;
}

interface JiraArtifactMetadata {
  projectKey?: string;
  projectName?: string;
  status?: string;
  issueKey?: string;
}

const ALL_PROJECTS_KEY = '__all__';
const UNKNOWN_PROJECT_KEY = '__unknown__';

const sources = ref<SourceModel[]>([]);
const issues = ref<ArtifactModel[]>([]);
const selectedSourceId = ref<string>();
const selectedIssueId = ref<string>();
const selectedProjectKey = ref<string>(ALL_PROJECTS_KEY);
const projectPanelOpen = ref(false);
const projectSearch = ref('');
const loadingSources = ref(false);
const loadingIssues = ref(false);
const navigationProjects = ref<ProjectOption[]>([]);
const errorMessage = ref<string>();
const pagination = ref({ page: 1, limit: 25, total: 0 });

const selectedSource = computed(() =>
  sources.value.find((source) => source.id === selectedSourceId.value)
);
const selectedIssue = computed(() =>
  issues.value.find((issue) => issue.id === selectedIssueId.value)
);
const selectedIssueData = computed<JiraArtifactData | undefined>(
  () => selectedIssue.value?.lastVersion?.data as JiraArtifactData | undefined
);
const selectedIssueMetadata = computed<JiraArtifactMetadata | undefined>(
  () => selectedIssue.value?.lastVersion?.metadata as JiraArtifactMetadata | undefined
);
const hasMore = computed(() => pagination.value.page * pagination.value.limit < pagination.value.total);
interface ProjectOption {
  key: string;
  label: string;
}
const issueProjectOptions = computed<ProjectOption[]>(() => {
  const map = new Map<string, ProjectOption>();
  for (const issue of issues.value) {
    const projectKey = issueProjectKey(issue) ?? UNKNOWN_PROJECT_KEY;
    if (!map.has(projectKey)) {
      map.set(projectKey, {
        key: projectKey,
        label: issueProjectLabel(issue, projectKey)
      });
    }
  }
  return Array.from(map.values());
});
// Merge navigation-provided projects with ones detected from issues so the selection list stays complete.
const projectOptions = computed<ProjectOption[]>(() => {
  const map = new Map<string, ProjectOption>();
  navigationProjects.value.forEach((option) => {
    map.set(option.key, option);
  });
  issueProjectOptions.value.forEach((option) => {
    if (!map.has(option.key)) {
      map.set(option.key, option);
    }
  });
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
});
const filteredIssues = computed(() => {
  if (!issues.value.length) return [];
  if (!selectedProjectKey.value || selectedProjectKey.value === ALL_PROJECTS_KEY) {
    return issues.value;
  }
  return issues.value.filter((issue) => {
    const projectKey = issueProjectKey(issue) ?? UNKNOWN_PROJECT_KEY;
    return projectKey === selectedProjectKey.value;
  });
});
const selectedProjectLabel = computed(() => {
  if (selectedProjectKey.value === ALL_PROJECTS_KEY || !projectOptions.value.length) {
    return 'All projects';
  }
  const selected = projectOptions.value.find((option) => option.key === selectedProjectKey.value);
  return selected?.label ?? selectedProjectKey.value ?? 'All projects';
});
// Mirror the Git browser toggles so the Jira button shows both state and selection context.
const projectButtonLabel = computed(() => {
  if (!projectOptions.value.length) {
    return 'No projects';
  }
  if (!selectedProjectKey.value || selectedProjectKey.value === ALL_PROJECTS_KEY) {
    return 'Select Project';
  }
  return `Project: ${selectedProjectLabel.value}`;
});
const visibleProjectOptions = computed(() => {
  if (!projectOptions.value.length) {
    return [];
  }
  const term = projectSearch.value.trim().toLowerCase();
  if (!term) {
    return projectOptions.value;
  }
  return projectOptions.value.filter((option) => {
    return (
      option.label.toLowerCase().includes(term) ||
      (option.key ?? '').toLowerCase().includes(term)
    );
  });
});

onMounted(async () => {
  await loadSources();
});

watch(
  filteredIssues,
  (next) => {
    if (!next.length) {
      selectedIssueId.value = undefined;
      return;
    }
    const exists = next.some((item) => item.id === selectedIssueId.value);
    if (!exists) {
      selectedIssueId.value = next[0].id;
    }
  },
  { immediate: true }
);

watch(
  selectedSourceId,
  async (next, prev) => {
    if (next && next !== prev) {
      selectedProjectKey.value = ALL_PROJECTS_KEY;
      projectPanelOpen.value = false;
      projectSearch.value = '';
      navigationProjects.value = [];
      await Promise.all([loadIssues(next), loadProjectNavigation(next)]);
    } else if (!next) {
      issues.value = [];
      navigationProjects.value = [];
      selectedProjectKey.value = ALL_PROJECTS_KEY;
      projectPanelOpen.value = false;
      projectSearch.value = '';
    }
  },
  { immediate: true }
);

watch(
  projectOptions,
  (next) => {
    if (!next.length) {
      selectedProjectKey.value = ALL_PROJECTS_KEY;
      projectPanelOpen.value = false;
      return;
    }
    if (
      selectedProjectKey.value !== ALL_PROJECTS_KEY &&
      !next.some((project) => project.key === selectedProjectKey.value)
    ) {
      selectedProjectKey.value = next[0].key;
    }
  },
  { immediate: true }
);

watch(projectPanelOpen, (next) => {
  if (!next) {
    projectSearch.value = '';
  }
});

function issueUpdatedTimestamp(issue?: ArtifactModel) {
  if (!issue) return 0;
  const data = issue.lastVersion?.data as JiraArtifactData | undefined;
  const candidates = [
    data?.updatedAt,
    issue.lastVersion?.metadata?.updatedAt,
    issue.updatedAt,
    issue.createdAt
  ];
  for (const value of candidates) {
    if (!value) continue;
    const time = Date.parse(value);
    if (!Number.isNaN(time)) {
      return time;
    }
  }
  return 0;
}

function sortIssues(items: ArtifactModel[]): ArtifactModel[] {
  return [...items].sort((a, b) => issueUpdatedTimestamp(b) - issueUpdatedTimestamp(a));
}

async function loadSources() {
  loadingSources.value = true;
  try {
    const response = await fetchSources({ pluginKey: 'jira', limit: 100 });
    sources.value = response.items;
    if (!selectedSourceId.value && response.items.length > 0) {
      selectedSourceId.value = response.items[0].id;
    }
  } catch (error: any) {
    errorMessage.value = error?.message ?? 'Failed to load Jira sources';
  } finally {
    loadingSources.value = false;
  }
}

async function loadIssues(sourceId: string, append = false) {
  if (!sourceId) return;
  loadingIssues.value = true;
  errorMessage.value = undefined;
  try {
    const nextPage = append ? pagination.value.page + 1 : 1;
    const response = await fetchArtifacts({
      sourceId,
      pluginKey: 'jira',
      limit: pagination.value.limit,
      page: nextPage
    });
    pagination.value = {
      page: response.page,
      limit: response.limit,
      total: response.total
    };
    issues.value = append ? sortIssues([...issues.value, ...response.items]) : sortIssues(response.items);
  } catch (error: any) {
    errorMessage.value = error?.message ?? 'Failed to load Jira issues';
  } finally {
    loadingIssues.value = false;
  }
}

async function loadProjectNavigation(sourceId: string) {
  if (!sourceId) {
    navigationProjects.value = [];
    return;
  }
  try {
    const navigation = await fetchNavigation(sourceId);
    navigationProjects.value = deriveProjectsFromNavigation(navigation?.nodes);
  } catch (error) {
    // Keep falling back to issue-derived projects if the navigation endpoint fails.
    navigationProjects.value = [];
  }
}

async function refreshIssues() {
  if (selectedSourceId.value) {
    await Promise.all([loadIssues(selectedSourceId.value), loadProjectNavigation(selectedSourceId.value)]);
  }
}

function loadMore() {
  if (selectedSourceId.value && hasMore.value && !loadingIssues.value) {
    loadIssues(selectedSourceId.value, true);
  }
}

function toggleProjectPanel() {
  projectPanelOpen.value = !projectPanelOpen.value;
}

function selectProject(key?: string) {
  selectedProjectKey.value = key ?? ALL_PROJECTS_KEY;
  projectPanelOpen.value = false;
}

function issueMetadata(issue?: ArtifactModel): JiraArtifactMetadata {
  return (issue?.lastVersion?.metadata ?? {}) as JiraArtifactMetadata;
}

function issueProjectKey(issue?: ArtifactModel) {
  const data = issue?.lastVersion?.data as JiraArtifactData | undefined;
  const metadata = issueMetadata(issue);
  return data?.project?.key ?? metadata.projectKey ?? undefined;
}

function issueProjectLabel(issue?: ArtifactModel, fallbackKey?: string) {
  const data = issue?.lastVersion?.data as JiraArtifactData | undefined;
  const metadata = issueMetadata(issue);
  const label = projectLabel(data, metadata);
  if (label === 'Unknown') {
    if (fallbackKey && fallbackKey !== UNKNOWN_PROJECT_KEY) {
      return fallbackKey;
    }
    return 'Unknown project';
  }
  return label;
}

function issueStatus(issue?: ArtifactModel) {
  const data = issue?.lastVersion?.data as JiraArtifactData | undefined;
  return data?.status ?? issue?.lastVersion?.metadata?.status ?? 'Unknown';
}

function issueAssignee(issue?: ArtifactModel) {
  const data = issue?.lastVersion?.data as JiraArtifactData | undefined;
  return data?.assignee?.displayName ?? 'Unassigned';
}

function issueSummary(issue?: ArtifactModel) {
  const data = issue?.lastVersion?.data as JiraArtifactData | undefined;
  return data?.summary ?? issue?.displayName ?? issue?.id;
}

function issueKey(issue?: ArtifactModel) {
  const data = issue?.lastVersion?.data as JiraArtifactData | undefined;
  return data?.key ?? issue?.displayName ?? issue?.id;
}

// Always hydrate the picker from navigation metadata so we show every project even when the current page of issues only contains one project.
function deriveProjectsFromNavigation(nodes?: NavigationNode[]): ProjectOption[] {
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes
    .map((node) => normalizeNavigationProjectNode(node))
    .filter((option): option is ProjectOption => Boolean(option));
}

function normalizeNavigationProjectNode(node?: NavigationNode): ProjectOption | null {
  if (!node?.id || typeof node.label !== 'string') {
    return null;
  }
  const prefix = 'project-';
  if (!node.id.startsWith(prefix)) {
    return null;
  }
  const key = node.id.slice(prefix.length);
  if (!key) {
    return null;
  }
  const label = node.label.trim().length ? node.label : key;
  return { key, label };
}

function projectLabel(data?: JiraArtifactData, metadata?: JiraArtifactMetadata) {
  const projectKey = data?.project?.key ?? metadata?.projectKey;
  const projectName = data?.project?.name ?? metadata?.projectName;
  if (!projectKey && !projectName) return 'Unknown';
  if (!projectKey) {
    return projectName ?? 'Unknown';
  }
  return projectName ? `${projectKey} – ${projectName}` : projectKey;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}

function renderDescription(description?: string) {
  if (!description) return 'No description available.';
  return description;
}

function sourceProjectLabel(source?: SourceModel) {
  if (!source) return undefined;
  const key = source.options?.projectKey ?? source.options?.projectKeys?.[0];
  // Custom JQL sources do not have a stable project key; hiding the fallback keeps the source list clean.
  return key;
}
</script>

<template>
  <div class="jira-browser">
    <aside>
      <header>
        <h3>Jira Sources</h3>
        <button type="button" class="ghost" @click="loadSources" :disabled="loadingSources">
          {{ loadingSources ? 'Refreshing…' : 'Refresh' }}
        </button>
      </header>
      <div v-if="loadingSources && !sources.length" class="placeholder">Loading sources…</div>
      <ul v-else>
        <li
          v-for="source in sources"
          :key="source.id"
          :class="{ active: source.id === selectedSourceId }"
          @click="selectedSourceId = source.id"
        >
          <p>{{ source.name }}</p>
          <small v-if="sourceProjectLabel(source)">{{ sourceProjectLabel(source) }}</small>
        </li>
      </ul>
      <p v-if="!sources.length && !loadingSources" class="placeholder">
        No Jira sources found. Create a source using the Jira plugin to get started.
      </p>
    </aside>

    <section class="issues-panel">
      <header>
        <div>
          <h3>Issues</h3>
          <p v-if="selectedSource">Showing artifacts for <strong>{{ selectedSource.name }}</strong></p>
        </div>
        <div class="actions">
          <button type="button" class="ghost" @click="refreshIssues" :disabled="loadingIssues">
            {{ loadingIssues ? 'Loading…' : 'Reload' }}
          </button>
          <button type="button" class="ghost" @click="loadMore" :disabled="!hasMore || loadingIssues">
            {{ hasMore ? 'Load more' : 'No more' }}
          </button>
        </div>
      </header>

      <div v-if="projectOptions.length" class="project-controls">
        <div class="view-tabs">
          <button
            type="button"
            :class="{ active: projectPanelOpen || selectedProjectKey !== ALL_PROJECTS_KEY }"
            @click="toggleProjectPanel"
          >
            {{ projectPanelOpen ? 'Hide Projects' : projectButtonLabel }}
          </button>
        </div>
        <p class="current-project">
          Showing:
          <strong>{{ selectedProjectLabel }}</strong>
        </p>
      </div>

      <div v-if="errorMessage" class="error-banner">
        {{ errorMessage }}
      </div>

      <div class="issues-workspace" :class="{ 'projects-visible': projectPanelOpen }">
        <aside class="project-panel" :class="{ visible: projectPanelOpen }" aria-label="Jira projects list">
          <header>
            <div>
              <h4>Projects</h4>
              <small>{{ projectOptions.length }} total</small>
            </div>
            <button type="button" class="ghost" @click="projectPanelOpen = false">Close</button>
          </header>
          <input
            type="search"
            v-model="projectSearch"
            placeholder="Search projects"
            :disabled="!projectOptions.length"
          />
          <div class="project-list">
            <button
              type="button"
              :class="{ active: selectedProjectKey === ALL_PROJECTS_KEY }"
              @click="selectProject()"
            >
              <span>All projects</span>
              <small>Any</small>
            </button>
            <button
              type="button"
              v-for="option in visibleProjectOptions"
              :key="option.key"
              :class="{ active: selectedProjectKey === option.key }"
              @click="selectProject(option.key)"
            >
              <span>{{ option.label }}</span>
              <small>{{ option.key }}</small>
            </button>
            <p v-if="projectOptions.length && !visibleProjectOptions.length" class="placeholder">
              No matching projects.
            </p>
          </div>
        </aside>

        <div class="issues-content">
          <div class="issue-list">
            <p v-if="!filteredIssues.length && !loadingIssues" class="placeholder">
              {{
                selectedProjectKey === ALL_PROJECTS_KEY
                  ? 'No Jira artifacts found for this source.'
                  : 'No Jira artifacts found for this project.'
              }}
            </p>
            <p v-else-if="loadingIssues && !issues.length" class="placeholder">Loading issues…</p>
            <ul v-else>
              <li
                v-for="issue in filteredIssues"
                :key="issue.id"
                :class="{ active: issue.id === selectedIssueId }"
                @click="selectedIssueId = issue.id"
              >
                <div class="issue-row">
                  <div>
                    <strong>{{ issueKey(issue) }}</strong>
                    <p>{{ issueSummary(issue) }}</p>
                  </div>
                  <div class="issue-meta">
                    <span class="badge">{{ issueStatus(issue) }}</span>
                    <small>{{ issueAssignee(issue) }}</small>
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <div class="issue-details" v-if="selectedIssue">
            <header>
              <div>
                <p class="issue-key">{{ selectedIssueData?.key }}</p>
                <h4>{{ selectedIssueData?.summary ?? selectedIssue.displayName }}</h4>
              </div>
              <div class="badges">
                <span class="badge primary">{{ selectedIssueData?.status ?? 'Unknown' }}</span>
                <span class="badge">{{ selectedIssueData?.issueType ?? 'Issue' }}</span>
                <span class="badge">{{ selectedIssueData?.priority ?? 'Unprioritized' }}</span>
              </div>
            </header>
            <ul class="chips">
              <li v-for="label in selectedIssueData?.labels ?? []" :key="label">{{ label }}</li>
            </ul>
            <p class="project-label">Project: {{ projectLabel(selectedIssueData, selectedIssueMetadata) }}</p>
            <article class="description">
              {{ renderDescription(selectedIssueData?.description) }}
            </article>
            <dl class="meta-grid">
              <div>
                <dt>Assignee</dt>
                <dd>{{ selectedIssueData?.assignee?.displayName ?? 'Unassigned' }}</dd>
              </div>
              <div>
                <dt>Reporter</dt>
                <dd>{{ selectedIssueData?.reporter?.displayName ?? 'Unknown' }}</dd>
              </div>
              <div>
                <dt>Story Points</dt>
                <dd>{{ selectedIssueData?.storyPoints ?? '—' }}</dd>
              </div>
              <div>
                <dt>Sprint</dt>
                <dd>{{ selectedIssueData?.sprint?.name ?? '—' }}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{{ formatDate(selectedIssueData?.createdAt) }}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{{ formatDate(selectedIssueData?.updatedAt) }}</dd>
              </div>
            </dl>
            <div v-if="selectedIssueData?.comments?.length" class="comments">
              <h5>Recent comments</h5>
              <ul>
                <li v-for="comment in selectedIssueData.comments" :key="comment.id">
                  <p class="comment-author">
                    {{ comment.author?.displayName ?? 'Unknown' }}
                    <small>{{ formatDate(comment.createdAt) }}</small>
                  </p>
                  <p>{{ comment.body }}</p>
                </li>
              </ul>
            </div>
            <p class="issue-link" v-if="selectedIssueData?.url">
              <a :href="selectedIssueData.url" target="_blank" rel="noopener noreferrer">Open in Jira ↗</a>
            </p>
          </div>
          <div v-else class="issue-details placeholder">Select an issue to see details.</div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.jira-browser {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 1rem;
}

aside {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

aside header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

aside ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

aside li {
  border: 1px solid transparent;
  border-radius: 0.375rem;
  padding: 0.5rem;
  cursor: pointer;
}

aside li.active {
  border-color: #2563eb;
  background: #eff6ff;
}

.issues-panel {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #fff;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.issues-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.issues-panel header h3 {
  margin: 0;
}

.actions {
  display: flex;
  gap: 0.5rem;
}

.placeholder {
  color: #6b7280;
  font-size: 0.9rem;
}

.error-banner {
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  background: #fee2e2;
  color: #991b1b;
}

.project-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin: 0.5rem 0;
  flex-wrap: wrap;
}

.project-controls .current-project {
  margin: 0;
  font-size: 0.9rem;
  color: #4b5563;
}

.project-controls .view-tabs {
  display: inline-flex;
  gap: 0.5rem;
}

.project-controls .view-tabs button {
  border: 1px solid #cbd5f5;
  border-radius: 999px;
  background: #fff;
  padding: 0.35rem 1rem;
  cursor: pointer;
}

.project-controls .view-tabs button.active {
  background: #1d4ed8;
  color: #fff;
  border-color: #1d4ed8;
}

.issues-workspace {
  display: flex;
  gap: 0;
  align-items: stretch;
  min-height: 360px;
  overflow: hidden;
}

.issues-workspace.projects-visible .issues-content {
  margin-left: 1rem;
}

.project-panel {
  flex: 0 0 auto;
  width: 280px;
  max-width: 280px;
  margin-right: -280px;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  background: #fff;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  overflow: hidden;
  pointer-events: none;
  transform: translateX(-100%);
  opacity: 0;
  transition: transform 0.3s ease, opacity 0.2s ease, margin-right 0.3s ease, box-shadow 0.2s ease;
}

.project-panel.visible {
  opacity: 1;
  pointer-events: auto;
  margin-right: 0;
  transform: translateX(0);
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.15);
  overflow: visible;
}

.project-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.project-panel header h4 {
  margin: 0;
}

.project-panel input[type='search'] {
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.4rem 0.6rem;
}

.project-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  overflow-y: auto;
}

.project-list button {
  border: 1px solid transparent;
  border-radius: 0.4rem;
  padding: 0.35rem 0.5rem;
  text-align: left;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  background: #f8fafc;
  cursor: pointer;
}

.project-list button.active {
  border-color: #1d4ed8;
  background: #dbeafe;
  color: #1d4ed8;
}

.project-list button small {
  color: #6b7280;
}

.issues-content {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 1rem;
  min-height: 360px;
  transition: margin-left 0.3s ease;
}

.issue-list ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.issue-list li {
  border: 1px solid #e5e7eb;
  border-radius: 0.45rem;
  padding: 0.5rem;
  cursor: pointer;
}

.issue-list li.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px #2563eb inset;
}

.issue-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.issue-row strong {
  display: block;
  font-size: 0.85rem;
  color: #1d4ed8;
}

.issue-row p {
  margin: 0;
  font-size: 0.9rem;
}

.issue-meta {
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
  /* Stack status above assignee so the badge stays top-right while the name sits just below it. */
}

.badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: #e5e7eb;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge.primary {
  background: #dbeafe;
  color: #1d4ed8;
}

.issue-details {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 0.75rem;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.issue-details header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}

.issue-details h4 {
  margin: 0;
}

.issue-key {
  margin: 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.badges {
  display: flex;
  gap: 0.4rem;
}

.chips {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chips li {
  background: #eef2ff;
  color: #4338ca;
  padding: 0.15rem 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.8rem;
}

.project-label {
  font-size: 0.9rem;
  color: #374151;
  margin: 0;
}

.description {
  background: #f3f4f6;
  border-radius: 0.5rem;
  padding: 0.75rem;
  white-space: pre-line;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.meta-grid dt {
  font-size: 0.75rem;
  color: #6b7280;
  text-transform: uppercase;
  margin-bottom: 0.15rem;
}

.meta-grid dd {
  margin: 0;
  font-weight: 600;
}

.comments {
  border-top: 1px solid #e5e7eb;
  padding-top: 0.5rem;
}

.comments ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.comment-author {
  margin: 0;
  font-weight: 600;
}

.comment-author small {
  margin-left: 0.3rem;
  font-weight: 400;
  color: #6b7280;
}

.issue-link a {
  color: #2563eb;
  font-weight: 600;
  text-decoration: none;
}

button.ghost {
  background: transparent;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
}

button.ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
