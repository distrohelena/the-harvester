# Changelog

All notable changes to this project will be documented here.

## [Unreleased]
- Work in progress.

## 2025-11-17
### Backend
- Added multi-source version discovery for the docs plugin (`versions.json`, `sitemap.xml`, option lists, inline links) and Docusaurus-aware slug handling so all versions (2.10.2, 2.9.7, etc.) are detected with correct base paths.
- Improved docs crawl logging (page URLs, skip events, detected versions, fallback warnings) and temporarily paused docs crawling to debug version detection before re-enabling it once the version list was accurate.
- Source extraction now logs checksum skips and version lists so we can trace behavior more easily.

### Frontend
- Introduced the Plugins → Documentation browser with tree navigation, collapsible nodes, heading permalinks, content link rewriting, and wrapped content view.
- Added configurable Vite host/port (for dev containers), pointer-friendly tree styling, and expand/collapse behavior improvements.
- Fixed Source form submissions so plugin options (e.g., max pages) persist and added the “Open original” link + package version display on artifact detail views.

