import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SourceEntity } from '../src/sources/source.entity.js';
import { ArtifactEntity } from '../src/artifacts/artifact.entity.js';
import { ArtifactVersionEntity } from '../src/artifacts/artifact-version.entity.js';
import { ExtractionRunEntity } from '../src/runs/extraction-run.entity.js';

const DEFAULT_URL =
  'postgres://artifact_harvester:artifact_harvester@localhost:5432/artifact_harvester';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? DEFAULT_URL,
  entities: [SourceEntity, ArtifactEntity, ArtifactVersionEntity, ExtractionRunEntity]
});

async function resetDatabase({ truncateSources }: { truncateSources: boolean }) {
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();

  try {
    if (truncateSources) {
      await queryRunner.query(
        'TRUNCATE TABLE artifact_versions, artifacts, extraction_runs, sources RESTART IDENTITY CASCADE'
      );
    } else {
      await queryRunner.query('TRUNCATE TABLE artifact_versions, artifacts RESTART IDENTITY CASCADE');
      await queryRunner.query('TRUNCATE TABLE extraction_runs RESTART IDENTITY CASCADE');
    }
    console.log('Database truncated successfully.');
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
}

const shouldResetSources = process.argv.includes('--all');

resetDatabase({ truncateSources: shouldResetSources }).catch((error) => {
  console.error('Failed to reset database:', error);
  process.exitCode = 1;
});
