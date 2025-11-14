import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourceEntity } from './source.entity.js';
import { SourcesService } from './sources.service.js';
import { SourcesController } from './sources.controller.js';
import { PluginModule } from '../plugins/plugin.module.js';
import { ExtractionModule } from '../extraction/extraction.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([SourceEntity]), PluginModule, ExtractionModule],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService]
})
export class SourcesModule {}
