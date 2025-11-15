import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { SourcesService } from './sources.service.js';
import { CreateSourceDto } from './dto/create-source.dto.js';
import { UpdateSourceDto } from './dto/update-source.dto.js';
import { FilterSourcesDto } from './dto/filter-sources.dto.js';
import { PluginRegistryService } from '../plugins/plugin-registry.service.js';
import { ExtractionQueueService } from '../extraction/queue/extraction-queue.service.js';

@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sourcesService: SourcesService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly extractionQueueService: ExtractionQueueService
  ) {}

  @Get()
  listSources(@Query() query: FilterSourcesDto) {
    return this.sourcesService.findAll(query);
  }

  @Get(':id')
  getSource(@Param('id') id: string) {
    return this.sourcesService.findOne(id);
  }

  @Post()
  createSource(@Body() dto: CreateSourceDto) {
    this.pluginRegistry.getPlugin(dto.pluginKey);
    return this.sourcesService.create(dto);
  }

  @Put(':id')
  updateSource(@Param('id') id: string, @Body() dto: UpdateSourceDto) {
    if (dto.pluginKey) {
      this.pluginRegistry.getPlugin(dto.pluginKey);
    }
    return this.sourcesService.update(id, dto);
  }

  @Delete(':id')
  deleteSource(@Param('id') id: string) {
    return this.sourcesService.remove(id);
  }

  @Post(':id/run')
  async runSource(@Param('id') id: string) {
    const source = await this.sourcesService.findOne(id);
    await this.extractionQueueService.enqueueSource(source.id);
    return { status: 'queued' };
  }
}
