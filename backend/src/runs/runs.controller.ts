import { Controller, Get, Param, Query } from '@nestjs/common';
import { RunsService } from './runs.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

@Controller('runs')
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Get()
  listRuns(@Query() query: PaginationQueryDto) {
    return this.runsService.findAll(query);
  }

  @Get(':id')
  getRun(@Param('id') id: string) {
    return this.runsService.findOne(id);
  }
}
