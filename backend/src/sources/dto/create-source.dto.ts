import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateSourceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  pluginKey!: string;

  @IsObject()
  options!: Record<string, any>;

  @IsOptional()
  @IsString()
  scheduleCron?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
