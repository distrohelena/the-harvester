import { IsInt, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @IsPositive()
  @Max(100)
  limit?: number = 25;

  @IsOptional()
  @IsString()
  search?: string;
}
