import { ConfigService } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';
import { ArtifactEntity } from '../artifacts/artifact.entity.js';
import { ArtifactVersionEntity } from '../artifacts/artifact-version.entity.js';
import { ExtractionRunEntity } from '../runs/extraction-run.entity.js';
import { SourceEntity } from '../sources/source.entity.js';

const DEFAULT_DATABASE_URL =
  'postgres://artifact_harvester:artifact_harvester@localhost:5432/artifact_harvester';

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Build TypeORM options from DATABASE_URL while normalizing IPv6 hostnames.
 * This avoids passing bracketed hosts (e.g. "[::1]") to Node DNS, which
 * would otherwise throw ENOTFOUND even though the address is valid.
 */
export function buildDatabaseOptions(config: ConfigService): DataSourceOptions {
  const rawUrl = config.get<string>('DATABASE_URL') ?? DEFAULT_DATABASE_URL;
  const parsed = new URL(rawUrl);

  const host = stripIpv6Brackets(parsed.hostname);
  const port = parsed.port ? Number(parsed.port) : 5432;
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = parsed.pathname?.replace(/^\//, '') ?? undefined;

  return {
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    entities: [SourceEntity, ArtifactEntity, ArtifactVersionEntity, ExtractionRunEntity],
    synchronize: true
  };
}
