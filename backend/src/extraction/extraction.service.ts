import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SourceEntity } from '../sources/source.entity.js';
import { ArtifactEntity } from '../artifacts/artifact.entity.js';
import { ArtifactVersionEntity } from '../artifacts/artifact-version.entity.js';
import { ExtractionRunEntity } from '../runs/extraction-run.entity.js';
import { PluginRegistryService } from '../plugins/plugin-registry.service.js';
import { NormalizedArtifact } from '../plugins/interfaces.js';
import { computeChecksum } from '../common/utils/checksum.util.js';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(
    @InjectRepository(SourceEntity)
    private readonly sourcesRepository: Repository<SourceEntity>,
    @InjectRepository(ArtifactEntity)
    private readonly artifactsRepository: Repository<ArtifactEntity>,
    @InjectRepository(ArtifactVersionEntity)
    private readonly artifactVersionsRepository: Repository<ArtifactVersionEntity>,
    @InjectRepository(ExtractionRunEntity)
    private readonly runsRepository: Repository<ExtractionRunEntity>,
    private readonly pluginRegistry: PluginRegistryService
  ) {}

  async runExtraction(sourceId: string) {
    const source = await this.sourcesRepository.findOne({ where: { id: sourceId } });
    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }

    const plugin = this.pluginRegistry.getPlugin(source.pluginKey);

    const run = this.runsRepository.create({
      source,
      status: 'RUNNING',
      startedAt: new Date(),
      createdArtifacts: 0,
      updatedArtifacts: 0,
      skippedArtifacts: 0
    });
    await this.runsRepository.save(run);

    try {
      const artifacts = await plugin.extract(source);
      await this.persistArtifacts(run, source, artifacts);
      run.status = 'SUCCESS';
      run.finishedAt = new Date();
      await this.runsRepository.save(run);
    } catch (error: any) {
      this.logger.error(`Extraction failed for source ${sourceId}`, error?.stack ?? String(error));
      run.status = 'FAILED';
      run.finishedAt = new Date();
      run.errorMessage = error?.message ?? 'Unknown error';
      await this.runsRepository.save(run);
      throw error;
    }

    return run;
  }

  private async persistArtifacts(
    run: ExtractionRunEntity,
    source: SourceEntity,
    artifacts: NormalizedArtifact[]
  ) {
    for (const artifact of artifacts) {
      // eslint-disable-next-line no-await-in-loop
      await this.persistArtifact(run, source, artifact);
    }
  }

  private async persistArtifact(
    run: ExtractionRunEntity,
    source: SourceEntity,
    normalized: NormalizedArtifact
  ) {
    const { externalId } = normalized;
    let artifact = await this.artifactsRepository.findOne({
      where: { externalId, source: { id: source.id } },
      relations: { lastVersion: true, source: true }
    });

    const checksum = computeChecksum({
      version: normalized.version,
      data: normalized.data,
      metadata: normalized.metadata
    });

    if (!artifact) {
      artifact = this.artifactsRepository.create({
        source,
        pluginKey: source.pluginKey,
        externalId,
        displayName: normalized.displayName
      });
      artifact = await this.artifactsRepository.save(artifact);
    }

    const latestChecksum = artifact.lastVersion?.checksum;
    if (latestChecksum === checksum) {
      run.skippedArtifacts += 1;
      return;
    }

    const versionEntity = this.artifactVersionsRepository.create({
      artifact,
      version: normalized.version,
      data: normalized.data,
      metadata: normalized.metadata ?? null,
      originalUrl: normalized.originalUrl ?? null,
      timestamp: normalized.timestamp ? new Date(normalized.timestamp) : null,
      checksum
    });

    await this.artifactVersionsRepository.save(versionEntity);

    artifact.displayName = normalized.displayName;
    artifact.lastVersion = versionEntity;
    await this.artifactsRepository.save(artifact);

    if (latestChecksum) {
      run.updatedArtifacts += 1;
    } else {
      run.createdArtifacts += 1;
    }
  }
}
