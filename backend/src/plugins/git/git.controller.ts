import { Controller, Get, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArtifactEntity } from '../../artifacts/artifact.entity.js';

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
    @Query('limit') limit = '25'
  ) {
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);
    const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 25;

    const qb = this.artifactsRepository
      .createQueryBuilder('artifact')
      .leftJoinAndSelect('artifact.source', 'source')
      .leftJoinAndSelect('artifact.lastVersion', 'lastVersion')
      .where('source.id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'git' })
      .andWhere(
        "(lastVersion.metadata ->> 'artifactType' = 'commit' OR lastVersion.metadata ->> 'artifactType' IS NULL)"
      )
      .orderBy('artifact.updatedAt', 'DESC')
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

    const qb = this.artifactsRepository
      .createQueryBuilder('artifact')
      .leftJoinAndSelect('artifact.source', 'source')
      .leftJoinAndSelect('artifact.lastVersion', 'lastVersion')
      .where('source.id = :sourceId', { sourceId })
      .andWhere('artifact.pluginKey = :pluginKey', { pluginKey: 'git' })
      .andWhere("lastVersion.metadata ->> 'artifactType' = 'file'")
      .andWhere("lastVersion.metadata ->> 'commitHash' = :commitHash", { commitHash })
      .orderBy('artifact.displayName', 'ASC')
      .take(safeLimit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: 1, limit: safeLimit };
  }
}
