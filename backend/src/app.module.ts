import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration.js';
import { SourceEntity } from './sources/source.entity.js';
import { ArtifactEntity } from './artifacts/artifact.entity.js';
import { ArtifactVersionEntity } from './artifacts/artifact-version.entity.js';
import { ExtractionRunEntity } from './runs/extraction-run.entity.js';
import { SourcesModule } from './sources/sources.module.js';
import { ArtifactsModule } from './artifacts/artifacts.module.js';
import { RunsModule } from './runs/runs.module.js';
import { PluginModule } from './plugins/plugin.module.js';
import { ExtractionModule } from './extraction/extraction.module.js';
import { NavigationModule } from './navigation/navigation.module.js';
import { buildDatabaseOptions } from './config/database.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => buildDatabaseOptions(config),
      inject: [ConfigService]
    }),
    PluginModule,
    SourcesModule,
    ArtifactsModule,
    RunsModule,
    ExtractionModule,
    NavigationModule
  ]
})
export class AppModule {}
