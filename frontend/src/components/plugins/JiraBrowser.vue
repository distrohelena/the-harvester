<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ArtifactModel, SourceModel } from '../../types/plugins';
import { fetchSources } from '../../api/sources';
import { fetchArtifacts } from '../../api/artifacts';

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

const sources = ref<SourceModel[]>([]);
const issues = ref<ArtifactModel[]>([]);
const selectedSourceId = ref<string>();
const selectedIssueId = ref<string>();
const loadingSources = ref(false);
const loadingIssues = ref(false);
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
const hasMore = computed(() => pagination.value.page * pagination.value.limit < pagination.value.total);

onMounted(async () => {
  await loadSources();
});

watch(
  issues,
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
      await loadIssues(next);
    } else if (!next) {
      issues.value = [];
    }
  },
  { immediate: true }
);

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
    if (!append && response.items.length > 0) {
      selectedIssueId.value = response.items[0].id;
    }
  } catch (error: any) {
    errorMessage.value = error?.message ?? 'Failed to load Jira issues';
  } finally {
    loadingIssues.value = false;
  }
}

function refreshIssues() {
  if (selectedSourceId.value) {
    loadIssues(selectedSourceId.value);
  }
}

function loadMore() {
  if (selectedSourceId.value && hasMore.value && !loadingIssues.value) {
    loadIssues(selectedSourceId.value, true);
  }
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

function projectLabel(data?: JiraArtifactData) {
  if (!data?.project?.key) return 'Unknown';
  return data.project.name ? `${data.project.key} – ${data.project.name}` : data.project.key;
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
          <small>{{ source.options?.projectKey ?? source.options?.projectKeys?.[0] ?? 'Custom JQL' }}</small>
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

      <div v-if="errorMessage" class="error-banner">
        {{ errorMessage }}
      </div>

      <div class="issues-content">
        <div class="issue-list">
          <p v-if="!issues.length && !loadingIssues" class="placeholder">
            No Jira artifacts found for this source.
          </p>
          <p v-else-if="loadingIssues && !issues.length" class="placeholder">Loading issues…</p>
          <ul>
            <li
              v-for="issue in issues"
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
          <p class="project-label">Project: {{ projectLabel(selectedIssueData) }}</p>
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

.issues-content {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 1rem;
  min-height: 360px;
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
