import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArtifactSummary } from '../src/artifact-repository.js';
import { resolveDocsHref } from '../src/plugins/docs/index.js';

const now = new Date().toISOString();

const baseArtifact: ArtifactSummary = {
  id: 'artifact-docs-payments',
  displayName: 'Payments',
  pluginKey: 'docs',
  externalId: 'docs:payments',
  source: {
    id: 'source-xrpl',
    name: 'XRPL Docs',
    pluginKey: 'docs'
  },
  lastVersion: {
    id: 'version-1',
    version: '1',
    metadata: {
      versionBasePath: '/docs/',
      versionRoot: 'https://xrpl.org/docs/'
    },
    data: {
      path: '/use-cases/payments'
    },
    originalUrl: 'https://xrpl.org/docs/use-cases/payments',
    timestamp: now,
    checksum: undefined,
    createdAt: now
  },
  createdAt: now,
  updatedAt: now
};

test('resolveDocsHref normalizes absolute doc links', () => {
  const path = resolveDocsHref(baseArtifact, '/docs/use-cases/tokenization');
  assert.equal(path, '/use-cases/tokenization');
});

test('resolveDocsHref handles relative links', () => {
  const path = resolveDocsHref(baseArtifact, 'tokenization');
  assert.equal(path, '/use-cases/tokenization');
});

test('resolveDocsHref ignores non-doc origins', () => {
  const path = resolveDocsHref(baseArtifact, 'https://example.com/elsewhere');
  assert.equal(path, null);
});

test('resolveDocsHref ignores intra-page anchors', () => {
  const path = resolveDocsHref(baseArtifact, '#payments');
  assert.equal(path, null);
});
