import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { ArtifactEntity } from '../../artifacts/artifact.entity.js';

interface SnapshotFileEntry {
  path: string;
  mode?: string;
  size?: number;
  blobSha?: string;
  externalId: string;
  sourceCommitHash?: string;
}

type GitCommitSortOption = 'newest' | 'oldest' | 'author' | 'message';
const GIT_COMMIT_SORT_OPTIONS: GitCommitSortOption[] = ['newest', 'oldest', 'author', 'message'];

function normalizeCommitSort(sort?: string): GitCommitSortOption {
  if (sort && GIT_COMMIT_SORT_OPTIONS.includes(sort as GitCommitSortOption)) {
    return sort as GitCommitSortOption;
  }
  return 'newest';
}

function applyCommitSorting(
  qb: SelectQueryBuilder<ArtifactEntity>,
  sort: GitCommitSortOption
): SelectQueryBuilder<ArtifactEntity> {
  switch (sort) {
    case 'oldest':
      return qb
        .orderBy('lastVersion.timestamp', 'ASC', 'NULLS LAST')
        .addOrderBy('artifact.updatedAt', 'ASC');
    case 'author':
      return qb
        .orderBy(
          "COALESCE(lastVersion.data ->> 'author', lastVersion.metadata ->> 'author', artifact.displayName)",
          'ASC',
          'NULLS LAST'
        )
        .addOrderBy('lastVersion.timestamp', 'DESC', 'NULLS LAST');
    case 'message':
      return qb
        .orderBy(
          "COALESCE(lastVersion.data ->> 'message', artifact.displayName, lastVersion.version)",
          'ASC',
          'NULLS LAST'
        )
        .addOrderBy('lastVersion.timestamp', 'DESC', 'NULLS LAST');
    case 'newest':
    default:
      return qb
        .orderBy('lastVersion.timestamp', 'DESC', 'NULLS LAST')
        .addOrderBy('artifact.updatedAt', 'DESC');
  }
}

@Controller('plugins/git')
export class GitPluginController {
  constructor(
    @InjectRepository(ArtifactEntity)
    private readonly artifactsRepository: Repository<ArtifactEntity>
  ) {}

  @Get('sources/:sourceId/commits')
  async listCommits(
    @Param('sourceId') sourceId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '25',
    @Query('search') search?: string,
    @Query('sort') sort?: string
  ) {
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);
    const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 25;
    const normalizedSort = normalizeCommitSort(sort);
    const trimmedSearch = search?.trim();

    const qb = this.artifactsRepository
      .createQueryBuilder('artifact')
      .leftJoinAndSelect('artifact.source', 'source')
      .leftJoinAndSelect('artifact.lastVersion', 'lastVersion')
      .where('source.id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'git' })
      .andWhere(
        "(lastVersion.metadata ->> 'artifactType' = 'commit' OR lastVersion.metadata ->> 'artifactType' IS NULL)"
      );

    if (trimmedSearch) {
      const searchParam = `%${trimmedSearch}%`;
      qb.andWhere(
        `(
          artifact.displayName ILIKE :search
          OR artifact.externalId ILIKE :search
          OR lastVersion.version ILIKE :search
          OR (lastVersion.data ->> 'message') ILIKE :search
          OR (lastVersion.data ->> 'author') ILIKE :search
          OR (lastVersion.metadata ->> 'author') ILIKE :search
          OR (lastVersion.data ->> 'commitHash') ILIKE :search
        )`,
        { search: searchParam }
      );
    }

    applyCommitSorting(qb, normalizedSort)
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: safePage, limit: safeLimit };
  }

  @Get('sources/:sourceId/commits/:commitHash/files')
  async listCommitFiles(
    @Param('sourceId') sourceId: string,
    @Param('commitHash') commitHash: string,
    @Query('limit') limit = '500'
  ) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 2000)
      : 500;

    const commitArtifact = await this.artifactsRepository
      .createQueryBuilder('artifact')
      .leftJoinAndSelect('artifact.source', 'source')
      .leftJoinAndSelect('artifact.lastVersion', 'lastVersion')
      .where('source.id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'git' })
      .andWhere("(lastVersion.data ->> 'artifactType') = 'commit'")
      .andWhere("(lastVersion.data ->> 'commitHash') = :commitHash", { commitHash })
      .getOne();

    const commitVersionData = commitArtifact?.lastVersion?.data as Record<string, any> | undefined;
    const fileExternalIds = Array.isArray(commitVersionData?.fileArtifacts)
      ? commitVersionData.fileArtifacts.filter((id: unknown): id is string => typeof id === 'string')
      : [];

    if (!fileExternalIds.length) {
      return { items: [], total: 0, page: 1, limit: safeLimit };
    }

    const limitedExternalIds = fileExternalIds.slice(0, safeLimit);

    const qb = this.artifactsRepository
      .createQueryBuilder('artifact')
      .leftJoinAndSelect('artifact.source', 'source')
      .leftJoinAndSelect('artifact.lastVersion', 'lastVersion')
      .where('source.id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'git' })
      .andWhere("(lastVersion.data ->> 'artifactType') = 'file'")
      .andWhere('artifact.externalId IN (:...externalIds)', { externalIds: limitedExternalIds })
      .orderBy('artifact.displayName', 'ASC');

    const items = await qb.getMany();
    return { items, total: fileExternalIds.length, page: 1, limit: safeLimit };
  }

  @Get('sources/:sourceId/commits/:commitHash/snapshot')
  async listCommitSnapshot(
    @Param('sourceId') sourceId: string,
    @Param('commitHash') commitHash: string,
    @Query('limit') limit = '0'
  ) {
    const parsedLimit = Number(limit);
    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50000) : undefined;
    const snapshotEntries = await this.loadCommitSnapshotEntries(sourceId, commitHash);
    const items = safeLimit ? snapshotEntries.slice(0, safeLimit) : snapshotEntries;
    return { items, total: snapshotEntries.length };
  }

  @Get('sources/:sourceId/commits/:commitHash/blob')
  async readCommitFile(
    @Param('sourceId') sourceId: string,
    @Param('commitHash') commitHash: string,
    @Query('path') path?: string
  ) {
    if (!path) {
      throw new BadRequestException('Query parameter "path" is required.');
    }
    const snapshotEntry = await this.findSnapshotEntry(sourceId, commitHash, path);
    const artifact = await this.artifactsRepository
      .createQueryBuilder('artifact')
      .leftJoinAndSelect('artifact.lastVersion', 'lastVersion')
      .leftJoinAndSelect('artifact.source', 'source')
      .where('source.id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'git' })
      .andWhere('artifact.externalId = :externalId', { externalId: snapshotEntry.externalId })
      .getOne();

    const artifactData = artifact?.lastVersion?.data as Record<string, any> | undefined;
    if (!artifactData?.content) {
      throw new NotFoundException(`File ${path} not found in ${commitHash}.`);
    }
    return {
      path: snapshotEntry.path,
      mode: snapshotEntry.mode ?? artifactData.mode,
      size: snapshotEntry.size ?? artifactData.size,
      blobSha: snapshotEntry.blobSha ?? artifactData.blobSha,
      encoding: artifactData.encoding ?? 'utf8',
      content: artifactData.content,
      sourceCommitHash: snapshotEntry.sourceCommitHash
    };
  }

  private async loadCommitSnapshotEntries(
    sourceId: string,
    commitHash: string
  ): Promise<SnapshotFileEntry[]> {
    const commitArtifact = await this.artifactsRepository
      .createQueryBuilder('artifact')
      .leftJoinAndSelect('artifact.source', 'source')
      .leftJoinAndSelect('artifact.lastVersion', 'lastVersion')
      .where('source.id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'git' })
      .andWhere("(lastVersion.data ->> 'artifactType') = 'commit'")
      .andWhere("(lastVersion.data ->> 'commitHash') = :commitHash", { commitHash })
      .getOne();

    const commitVersionData = commitArtifact?.lastVersion?.data as Record<string, any> | undefined;
    if (!commitVersionData?.snapshotFiles) {
      return [];
    }
    return (commitVersionData.snapshotFiles as SnapshotFileEntry[]).map((entry) => ({
      path: entry.path,
      mode: entry.mode,
      size: entry.size,
      blobSha: entry.blobSha,
      externalId: entry.externalId,
      sourceCommitHash: entry.sourceCommitHash
    }));
  }

  private async findSnapshotEntry(
    sourceId: string,
    commitHash: string,
    path: string
  ): Promise<SnapshotFileEntry> {
    const entries = await this.loadCommitSnapshotEntries(sourceId, commitHash);
    const entry = entries.find((item) => item.path === path);
    if (!entry) {
      throw new NotFoundException(`File ${path} not found in commit ${commitHash}.`);
    }
    return entry;
  }
}
