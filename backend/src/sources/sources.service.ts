import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { SourceEntity } from './source.entity.js';
import { CreateSourceDto } from './dto/create-source.dto.js';
import { UpdateSourceDto } from './dto/update-source.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

@Injectable()
export class SourcesService {
  constructor(
    @InjectRepository(SourceEntity)
    private readonly sourcesRepository: Repository<SourceEntity>
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { page = 1, limit = 25, search } = query;
    const where: FindOptionsWhere<SourceEntity>[] | undefined = search
      ? [
          { name: ILike(`%${search}%`) },
          { pluginKey: ILike(`%${search}%`) }
        ]
      : undefined;

    const [items, total] = await this.sourcesRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' }
    });

    return { items, total, page, limit };
  }

  async findOne(id: string) {
    const source = await this.sourcesRepository.findOne({ where: { id } });
    if (!source) {
      throw new NotFoundException(`Source ${id} not found`);
    }
    return source;
  }

  async create(dto: CreateSourceDto) {
    const entity = this.sourcesRepository.create(dto);
    return this.sourcesRepository.save(entity);
  }

  async update(id: string, dto: UpdateSourceDto) {
    const source = await this.findOne(id);
    const merged = this.sourcesRepository.merge(source, dto);
    return this.sourcesRepository.save(merged);
  }

  async remove(id: string) {
    const source = await this.findOne(id);
    await this.sourcesRepository.remove(source);
    return { id };
  }
}
