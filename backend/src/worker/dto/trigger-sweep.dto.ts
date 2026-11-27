import { IsDateString, IsOptional } from 'class-validator';

export class TriggerSweepDto {
  @IsOptional()
  @IsDateString()
  now?: string;
}
