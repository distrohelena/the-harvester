# Artifact Harvester

This repo follows the `AGENTS.md` specification for a plugin-driven artifact extraction system built with a NestJS backend and a Vue 3 frontend.

## Structure

```
/mnt/c/dev/harvester
├── agents.md                # Project specification (do not edit)
├── backend/                 # NestJS application
└── frontend/                # Vite + Vue 3 SPA
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
- **Artifact explorer** with search/filtering and JSON-based detail viewer + version history.
- **Plugin navigation views** (`DocsNavigationView`, `GitNavigationView`, `PlainWebsiteNavigationView`) rendered through a `NavigationRenderer` based on plugin-provided navigation schema.
- Dedicated **Runs dashboard** for monitoring extraction progress.

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

This makes it easy to point the harvester at frameworks whose docs publish multiple live versions (e.g., `/docs/v2`, `/docs/v3`). Each scraped page becomes an artifact keyed by version so you can diff and browse per release.

## Jira Plugin
The `jira` plugin mirrors the workflow used in the standalone Jira VS Code extension: supply the Jira site URL plus your user email + API token and the harvester automatically:

- Discovers every accessible project through Jira's REST API.
- Pulls the latest issues for each project (up to 200 per project) with their summary, status, assignee, labels, and timestamps.
- Builds navigation grouped by project → status, so you can browse tickets the same way as the editor integration.

No extra configuration is required—just point it at a Jira tenant and the extractor handles pagination, legacy endpoint fallbacks, and artifact normalization. On the frontend the **Plugins → Jira** tab lists sources, renders projects/issues, and links directly back to Jira for deeper actions.

## Next Steps
- Implement real extraction logic inside the git and plain_website plugins.
- Harden validation (per-field option validation, JSON schema, etc.).
- Add authentication/authorization if needed.
- Build automated tests (unit + integration) around services and Vue stores/components.

Refer to `agents.md` for the canonical requirements.
