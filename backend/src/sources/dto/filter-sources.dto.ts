import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class FilterSourcesDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  pluginKey?: string;
}
