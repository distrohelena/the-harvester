import { Module } from '@nestjs/common';
import { NavigationController } from './navigation.controller.js';
import { NavigationService } from './navigation.service.js';
import { PluginModule } from '../plugins/plugin.module.js';
import { SourcesModule } from '../sources/sources.module.js';

@Module({
  imports: [PluginModule, SourcesModule],
  controllers: [NavigationController],
  providers: [NavigationService]
})
export class NavigationModule {}
