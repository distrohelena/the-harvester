import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractionRunEntity } from './extraction-run.entity.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

@Injectable()
export class RunsService {
  constructor(
    @InjectRepository(ExtractionRunEntity)
    private readonly runsRepository: Repository<ExtractionRunEntity>
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { page = 1, limit = 25 } = query;
    const [items, total] = await this.runsRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
      relations: { source: true }
    });
    return { items, total, page, limit };
  }

  async findOne(id: string) {
    const run = await this.runsRepository.findOne({ where: { id }, relations: { source: true } });
    if (!run) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    return run;
  }
}
