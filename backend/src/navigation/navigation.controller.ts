import { Controller, Get, Param } from '@nestjs/common';
import { NavigationService } from './navigation.service.js';

@Controller('sources/:id/navigation')
export class NavigationController {
  constructor(private readonly navigationService: NavigationService) {}

  @Get()
  buildNavigation(@Param('id') id: string) {
    return this.navigationService.buildNavigation(id);
  }
}
