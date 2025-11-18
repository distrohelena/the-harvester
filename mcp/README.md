# Artifact MCP Server

This package exposes the Artifact Harvester database via the [Model Context Protocol](https://modelcontextprotocol.io). It ships as both a web (Streamable HTTP) service and a local stdio server so MCP-compatible clients and LLM hosts can tap into every harvested project.

## Features
- **list-sources tool** – enumerates up to 1000+ projects with plugin keys, active status, and artifact counts so users/LLMs can pick targets before searching.
- **search-artifacts tool** – free-text search across names, plugin keys, metadata, and source info with cursor-based pagination.
- **artifact://{artifactId} resource** – resolves to the latest artifact snapshot (metadata + JSON payload) with autocomplete and a recent-artifacts listing.
- Designed to scale for thousands of projects by letting clients discover scopes first, then narrow searches.

## Setup
```bash
cd mcp
npm install
```

### Environment variables
| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://artifact_harvester:artifact_harvester@localhost:5432/artifact_harvester` | PostgreSQL connection string shared with the backend. |
| `MCP_TRANSPORT` | `http` | `http` for Streamable HTTP (web) or `stdio` for local spawning. |
| `MCP_MAX_SEARCH_RESULTS` | `25` | Max results per search (clamped to 50). |
| `MCP_RESOURCE_SAMPLE_SIZE` | `20` | Number of recent artifacts advertised for resource browsing. |
| `MCP_HTTP_PORT` | `3333` | HTTP listen port when `MCP_TRANSPORT=http`. |
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind host for HTTP mode. |
| `MCP_HTTP_PATH` | `/mcp` | Endpoint path for HTTP requests. |
| `MCP_HTTP_ALLOWED_ORIGINS` | *(empty)* | Comma-separated list for DNS-rebinding protection. |
| `MCP_HTTP_ALLOWED_HOSTS` | *(empty)* | Comma-separated allowed Host headers. |
| `MCP_HTTP_DNS_PROTECTION` | `true` | Toggle DNS-rebinding protection.

Create a `.env` file if needed and run `npm run build && npm start` for HTTP mode, or `MCP_TRANSPORT=stdio npm run dev` when integrating with a local MCP host.

## Running
- **Web (default):** `npm run build && npm start` launches the HTTP server on `http://$MCP_HTTP_HOST:$MCP_HTTP_PORT$MCP_HTTP_PATH`.
- **Local stdio:** `MCP_TRANSPORT=stdio npm run dev` – ideal for Claude Code, Cursor, or MCP Inspector spawning the process.

Once running, register the server with your MCP host using the Streamable HTTP URL or command to spawn the stdio process. Then use `list-sources` → `search-artifacts` → `artifact://{id}` in natural language; the MCP schema guides the LLM so humans never need to remember parameter names. When in HTTP mode you can `GET $MCP_HTTP_PATH/health` to receive a JSON readiness message confirming the endpoint path and version.
