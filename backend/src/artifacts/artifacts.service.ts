import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { ArtifactEntity } from './artifact.entity.js';
import { ArtifactVersionEntity } from './artifact-version.entity.js';
import { FilterArtifactsDto } from './dto/filter-artifacts.dto.js';

@Injectable()
export class ArtifactsService {
  constructor(
    @InjectRepository(ArtifactEntity)
    private readonly artifactsRepository: Repository<ArtifactEntity>,
    @InjectRepository(ArtifactVersionEntity)
    private readonly artifactVersionsRepository: Repository<ArtifactVersionEntity>
  ) {}

  async findAll(query: FilterArtifactsDto) {
    const { page = 1, limit = 25, search, sourceId, pluginKey } = query;

    const where: FindOptionsWhere<ArtifactEntity> = {};
    if (sourceId) {
      where.source = { id: sourceId } as any;
    }
    if (pluginKey) {
      where.pluginKey = pluginKey;
    }
    if (search) {
      where.displayName = ILike(`%${search}%`);
    }

    const [items, total] = await this.artifactsRepository.findAndCount({
      where,
      relations: { source: true, lastVersion: true },
      skip: (page - 1) * limit,
      take: limit,
      order: { updatedAt: 'DESC' }
    });

    return { items, total, page, limit };
  }

  async findOne(id: string) {
    const artifact = await this.artifactsRepository.findOne({
      where: { id },
      relations: { source: true, lastVersion: true }
    });

    if (!artifact) {
      throw new NotFoundException(`Artifact ${id} not found`);
    }

    return artifact;
  }

  async findVersions(artifactId: string) {
    await this.findOne(artifactId);
    return this.artifactVersionsRepository.find({
      where: { artifact: { id: artifactId } },
      order: { createdAt: 'DESC' }
    });
  }

  async findVersion(id: string) {
    const version = await this.artifactVersionsRepository.findOne({ where: { id }, relations: { artifact: true } });
    if (!version) {
      throw new NotFoundException(`Artifact version ${id} not found`);
    }
    return version;
  }
}
