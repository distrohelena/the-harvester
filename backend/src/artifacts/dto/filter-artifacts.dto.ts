import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class FilterArtifactsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  pluginKey?: string;
}
