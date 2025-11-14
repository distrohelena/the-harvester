# AGENTS SPECIFICATION

Below is the full, consolidated specification for the multi‑plugin artifact extraction system, formatted as an `AGENTS.MD` file.

---

# 1. Overview

**Name (placeholder):** Artifact Harvester  
**Architecture:** NestJS backend + Vue 3 frontend (all TypeScript)  
**Purpose:** A plugin‑based system that:

- Extracts and versions data ("artifacts") from many kinds of sources.
- Supports documentation crawlers, Git commit extractors, generic website scrapers, and any future plugin type.
- Provides scheduled extraction using BullMQ.
- Stores all artifacts and version history in a database.
- Exposes a generic browsing UI **plus plugin‑specific navigation UIs**.
- Uses dynamic forms on the frontend generated from plugin schemas.

---

# 2. Core Concepts

## 2.1 Artifact
A **generic unit of extracted content**. Examples:
- A documentation page
- A Git commit
- A plain HTML webpage
- Any plugin-defined resource

Properties:
- Belongs to a **Source**
- Produced by a **Plugin**
- Has many **ArtifactVersions** (new version when data changes)

## 2.2 Source
A registered extraction target created by an Admin.

Fields:
- `name`: label
- `pluginKey`: which plugin processes this source
- `options`: plugin-specific configuration JSON
- `scheduleCron`: optional cron-like string for periodic extraction
- `isActive`: boolean

## 2.3 Plugins
Plugins define **what** to extract, **how** to extract, **how the form looks**, **how artifacts are shaped**, and **how navigation works**.

Each plugin exposes:

```ts
interface PluginDescriptor {
  key: string;
  name: string;
  optionsSchema: PluginSchema;        // dynamic Source configuration form
  artifactSchema: PluginSchema;       // structure of artifact.data
  navigationSchema?: PluginNavigationSchema;  // frontend hints for navigation UI
}

interface Plugin {
  descriptor: PluginDescriptor;
  extract(source: SourceEntity): Promise<NormalizedArtifact[]>;
  buildNavigation?(sourceId: string): Promise<any>;
}

interface NormalizedArtifact {
  externalId: string;
  displayName: string;
  version: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
  originalUrl?: string;
  timestamp?: string;
}
```

## 2.4 Plugin Schema Format
Used for dynamic forms and defining shape of `artifact.data`.

```ts
interface PluginSchemaField {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum" | "array" | "object";
  required?: boolean;
  enumValues?: string[];
  description?: string;
}

interface PluginSchema {
  fields: PluginSchemaField[];
}
```

## 2.5 Plugin Examples

### Docs Plugin
- Extracts documentation pages
- Options include: `baseUrl`, `startPaths`, `maxPages` CSS selectors, etc.
- Navigation: tree of sections → pages → versions

### Git Plugin
- Extracts commits from a repository
- Options: `repoUrl`, `branch`, `authToken`
- Navigation: commit history, grouped by date or branch

### Plain Website Plugin
- Extracts HTML/text content
- Options: `url`, CSS selector
- Navigation: simple list or none

---

# 3. Backend Architecture

## 3.1 Technologies
- NestJS (TypeScript)
- PostgreSQL
- Prisma or TypeORM ORM
- BullMQ + Redis for extraction jobs
- REST API

## 3.2 Data Model

### Source
- `id`
- `name`
- `pluginKey`
- `options` (JSON)
- `scheduleCron` (nullable)
- `isActive`
- timestamps

### Artifact
- `id`
- `sourceId`
- `pluginKey`
- `externalId`
- `displayName`
- `lastVersionId`
- timestamps

### ArtifactVersion
- `id`
- `artifactId`
- `version`
- `data` (JSON, plugin-defined)
- `metadata`
- `originalUrl`
- `timestamp`
- `checksum`
- createdAt

### ExtractionRun
- `id`
- `sourceId`
- `startedAt`
- `finishedAt`
- `status`: PENDING | RUNNING | SUCCESS | FAILED
- `errorMessage`
- `createdArtifacts`
- `updatedArtifacts`
- `skippedArtifacts`

## 3.3 Extraction Job Flow (BullMQ)
1. Load Source
2. Load Plugin
3. Run `plugin.extract(source)`
4. For each artifact:
   - Find or create Artifact
   - Compute checksum of new version
   - If changed → create new ArtifactVersion
   - If same → skip
5. Persist run stats into `ExtractionRun`

## 3.4 Backend Endpoints

### Plugins
- `GET /plugins` → list plugin descriptors

### Sources
- `GET /sources`
- `POST /sources`
- `GET /sources/:id`
- `PUT /sources/:id`
- `DELETE /sources/:id`

### Extraction
- `POST /sources/:id/run` → enqueue immediate job
- `GET /runs` → list
- `GET /runs/:id` → details

### Artifacts
- `GET /artifacts`
  - filters: `sourceId`, `pluginKey`, `search`, `page`, etc.
- `GET /artifacts/:id`
- `GET /artifacts/:id/versions`
- `GET /artifact-versions/:id`

### Navigation
- `GET /sources/:id/navigation`
  - uses plugin.buildNavigation

---

# 4. Frontend Architecture

## 4.1 Technologies
- Vue 3 + TypeScript
- Vite
- Pinia / composables

## 4.2 Dynamic Plugin Forms
- `GET /plugins`
- Select plugin → extract `optionsSchema` → generate form
- Validate fields according to schema
- Submit JSON `options` to backend

## 4.3 Artifact Explorer (Generic)
- Filters by plugin, source, text search
- List showing: displayName, plugin, source, timestamp
- Detail page:
  - Generic JSON viewer for `artifact.data`
  - Version history on the side

## 4.4 Plugin-Specific Navigation
- Fetch `navigationSchema` from plugin descriptor
- Fetch `GET /sources/:id/navigation`
- Render using dedicated Vue components:
  - `DocsNavigationView`
  - `GitNavigationView`
  - `PlainWebsiteNavigationView`
- Navigation links resolve to specific Artifacts

## 4.5 Source Management
- CRUD with dynamic forms
- Trigger manual extraction
- View run logs

---

# 5. Non-Functional Requirements

- Validate `options` against plugin schema
- Ensure pluginKey exists
- Checksums ensure correct versioning
- Indexes on common DB fields
- Full-text search optional (Postgres FTS)
- Plugins must be easy to add without modifying core logic

---

# 6. Deliverables (what Codex must generate)

## Backend
- NestJS project with modular plugin system
- Example plugins: docs, git, plain_website
- Dynamic plugin registry
- Extraction system with BullMQ
- REST endpoints
- Prisma/TypeORM models
- Sample configuration files

## Frontend
- Vue 3 application
- Dynamic form engine based on plugin schemas
- Unified artifact explorer
- Plugin-specific navigation components
- Source management UI

---

# 7. Summary
This system is a **unified, extensible architecture** for crawling, versioning, and exploring any kind of external data source using a plugin model. It supports scheduled extraction, universal artifact storage, dynamic configuration, and specialized navigation per plugin type.

This file defines everything Codex must use to scaffold the backend, frontend, data model, plugin system, and UI behaviors.

