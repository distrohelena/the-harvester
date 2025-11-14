import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArtifactEntity } from './artifact.entity.js';
import { ArtifactVersionEntity } from './artifact-version.entity.js';
import { ArtifactsService } from './artifacts.service.js';
import { ArtifactsController } from './artifacts.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([ArtifactEntity, ArtifactVersionEntity])],
  providers: [ArtifactsService],
  controllers: [ArtifactsController],
  exports: [ArtifactsService]
})
export class ArtifactsModule {}
