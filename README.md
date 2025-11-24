# Artifact Harvester

This repo follows the `AGENTS.md` specification for a plugin-driven artifact extraction system built with a NestJS backend and a Vue 3 frontend.

## Structure

```
/mnt/c/dev/harvester
├── agents.md                # Project specification (do not edit)
├── backend/                 # NestJS application
├── frontend/                # Vite + Vue 3 SPA
└── mcp/                     # MCP server (HTTP + stdio) exposing harvested artifacts
```

### Backend Highlights
- **NestJS + TypeORM** with entities for Sources, Artifacts, ArtifactVersions, and ExtractionRuns.
- **BullMQ queue** (`artifact-harvester-extractions`) schedules extraction jobs through `ExtractionQueueService` and `ExtractionProcessor` workers.
- **Plugin system** with registry-provided descriptors and extractors for `docs`, `confluence`, `git`, `jira`, and `plain_website` plugins.
- **REST API** matching `AGENTS.md`: `/plugins`, `/sources`, `/artifacts`, `/runs`, `/sources/:id/run`, `/sources/:id/navigation`, etc.
- **Extraction pipeline** (`ExtractionService`) normalizes plugin output, computes checksums, versions artifacts, and records run statistics.

### Frontend Highlights
- **Vue 3 + Pinia + Vue Router** single-page app served from `frontend/`.
- Dynamic **Source management** UI with schema-driven forms generated from plugin descriptors.
- Git plugin credential fields now render as password inputs so SSH tokens and private keys stay hidden in the UI.
- **Artifact explorer** with search/filtering and JSON-based detail viewer + version history.
- **Plugin navigation views** (`DocsNavigationView`, `GitNavigationView`, `PlainWebsiteNavigationView`) rendered through a `NavigationRenderer` based on plugin-provided navigation schema.
- Dedicated **Runs dashboard** for monitoring extraction progress.

### MCP Server Highlights
- Lives in `mcp/` and uses the official `@modelcontextprotocol/sdk`.
- **Streamable HTTP** endpoint (default) plus optional **stdio** mode for local hosts.
- Tools:
  - `list-sources` to enumerate thousands of projects with plugin key + activity flags.
  - `search-artifacts` with cursor-based pagination across names, metadata, and plugin info.
  - `git-search-commits` mirrors GitMCP by listing commits + their changed files for a given source so you can jump straight to relevant artifacts.
  - `git-commit-diff` renders per-file unified diffs (text files) so LLMs can reason about delta data and link directly to the backing file artifacts.
- Resource template `artifact://{artifactId}` exposes formatted summaries and raw metadata for any artifact with autocomplete + recent listings.
- Configurable via env vars (`DATABASE_URL`, `MCP_HTTP_PORT`, etc.) so you can deploy it alongside the backend and let MCP clients query every indexed project.

## Getting Started
1. **Install dependencies**
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. **Environment**
   - PostgreSQL connection via `DATABASE_URL` (defaults to `postgres://artifact_harvester:artifact_harvester@localhost:5432/artifact_harvester`).
   - Redis connection via `REDIS_URL` (defaults to `redis://localhost:6379`).

3. **Run services**
   - Backend: `npm run start:dev` from `backend/`.
   - Frontend: `npm run dev` from `frontend/` (proxies `/api` → `http://localhost:3000`).
   - MCP server: `cd mcp && npm run build && npm start` for HTTP mode, or `MCP_TRANSPORT=stdio npm run dev` for local stdio integrations.

BullMQ workers run inside the backend process (see `ExtractionProcessor`). Use `POST /sources/:id/run` or the frontend “Run Now” button to queue jobs.

## Dev Container
The repo ships with `.devcontainer/` assets so you can launch a pre-wired environment with PostgreSQL and Redis:

1. Install the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension (or use GitHub Codespaces).
2. Open the workspace folder in VS Code and select **“Reopen in Container”**.
3. The provided `docker-compose` stack starts:
   - `workspace`: Node.js 20 image with this repo mounted at `/workspace`.
   - `postgres`: `postgres:16` seeded with `artifact_harvester` DB/user/password.
   - `redis`: `redis:7`.
4. `DATABASE_URL` / `REDIS_URL` env vars inside the container already point to those services, and ports 3000/5173/5432/6379 are forwarded to your host.

After the container initializes, the `postCreateCommand` automatically installs backend and frontend dependencies, so you can run `npm run start:dev` / `npm run dev` immediately.

## Documentation Plugin
The `docs` plugin now understands versioned documentation portals:

- **Base URL** is required. Everything else is optional.
- **Automatic version discovery:** provide `versionIndexPath` (defaults to `/`) plus a `versionSelector` (CSS) that matches links for each version. Optionally specify `versionLabelAttribute` / `versionPathAttribute` if labels or URLs live on custom attributes.
- **Manual versions:** fill `manualVersions` with one entry per line shaped like `v2|/docs/v2/`. The part before `|` is the label, after is the path (relative or absolute). If omitted, the same value is used for both.
- **Start paths:** seed each version crawl with relative paths (default `/`). The crawler stays within the detected version prefix, following links that match `followSelector` (defaults to `a[href]`) until it reaches `maxPages` pages per version (default 50).
- **Content extraction:** customize `contentSelector`, `titleSelector`, and `headingSelector` (comma-separated selectors) to match each site.
- **Dual search:** the Docs browser now has a project-level search box above the structure tree plus a global sources search so you can highlight every project whose structure contains a match (with inline previews) before drilling into the exact page.
- **Version precedence:** when crawling, any semantic version embedded in the page URL (e.g., `/docs/3.4/...`) now overrides version text found inside the document so archived release notes don't trick the harvester into labeling the page as an older version.

This makes it easy to point the harvester at frameworks whose docs publish multiple live versions (e.g., `/docs/v2`, `/docs/v3`). Each scraped page becomes an artifact keyed by version so you can diff and browse per release.

## Jira Plugin
The `jira` plugin mirrors the workflow used in the standalone Jira VS Code extension: supply the Jira site URL plus your user email + API token and the harvester automatically:

- Discovers every accessible project through Jira's REST API.
- Pulls the latest issues for each project (leave the recent limit blank to fetch everything, or set a cap if you only need the most recent tickets) with their summary, status, assignee, labels, and timestamps.
- Builds navigation grouped by project → status, so you can browse tickets the same way as the editor integration.
- Uses the same **View Projects** toggle as the Git browser's branch/commit pills, so the button doubles as both the drawer control and a live indicator of which project filter (if any) is active—no need to reopen the drawer just to confirm the current scope.
- Hydrates that drawer from the Jira navigation API so that every project discovered during extraction is listed even when the currently loaded issue page only contains a single project's artifacts—this keeps the picker parity with Git's always-complete branch list.

No extra configuration is required—just point it at a Jira tenant and the extractor handles pagination, legacy endpoint fallbacks, and artifact normalization. On the frontend the **Plugins → Jira** tab lists sources, renders projects/issues, and links directly back to Jira for deeper actions.

## Next Steps
- Implement real extraction logic inside the git and plain_website plugins.
- Harden validation (per-field option validation, JSON schema, etc.).
- Add authentication/authorization if needed.
- Build automated tests (unit + integration) around services and Vue stores/components.
- Expand MCP integrations by adding more specialized tools if clients need direct JSON payloads or aggregation views per project.

Refer to `agents.md` for the canonical requirements.
