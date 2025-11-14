import { Controller, Get, Param, Query } from '@nestjs/common';
import { ArtifactsService } from './artifacts.service.js';
import { FilterArtifactsDto } from './dto/filter-artifacts.dto.js';

@Controller()
export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  @Get('artifacts')
  listArtifacts(@Query() query: FilterArtifactsDto) {
    return this.artifactsService.findAll(query);
  }

  @Get('artifacts/:id')
  getArtifact(@Param('id') id: string) {
    return this.artifactsService.findOne(id);
  }

  @Get('artifacts/:id/versions')
  getArtifactVersions(@Param('id') id: string) {
    return this.artifactsService.findVersions(id);
  }

  @Get('artifact-versions/:id')
  getArtifactVersion(@Param('id') id: string) {
    return this.artifactsService.findVersion(id);
  }
}
