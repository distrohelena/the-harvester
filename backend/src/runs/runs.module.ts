import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExtractionRunEntity } from './extraction-run.entity.js';
import { RunsService } from './runs.service.js';
import { RunsController } from './runs.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([ExtractionRunEntity])],
  providers: [RunsService],
  controllers: [RunsController],
  exports: [RunsService]
})
export class RunsModule {}
