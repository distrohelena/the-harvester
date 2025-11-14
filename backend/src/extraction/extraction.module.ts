import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourceEntity } from '../sources/source.entity.js';
import { ArtifactEntity } from '../artifacts/artifact.entity.js';
import { ArtifactVersionEntity } from '../artifacts/artifact-version.entity.js';
import { ExtractionRunEntity } from '../runs/extraction-run.entity.js';
import { PluginModule } from '../plugins/plugin.module.js';
import { ExtractionService } from './extraction.service.js';
import { ExtractionProcessor } from './extraction.processor.js';
import { ExtractionQueueService } from './queue/extraction-queue.service.js';
import { EXTRACTION_QUEUE } from './extraction.constants.js';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('redisUrl') ?? 'redis://localhost:6379' }
      }),
      inject: [ConfigService]
    }),
    BullModule.registerQueue({ name: EXTRACTION_QUEUE }),
    TypeOrmModule.forFeature([SourceEntity, ArtifactEntity, ArtifactVersionEntity, ExtractionRunEntity]),
    PluginModule
  ],
  providers: [ExtractionService, ExtractionProcessor, ExtractionQueueService],
  exports: [ExtractionQueueService]
})
export class ExtractionModule {}
