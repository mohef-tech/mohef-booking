import { IsOptional, IsString } from 'class-validator';

export class AdminCancelDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
