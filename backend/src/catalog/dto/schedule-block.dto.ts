import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class ListScheduleBlocksQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus berformat YYYY-MM-DD',
  })
  date?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;
}

export class CreateScheduleBlockDto {
  @IsOptional()
  @IsUUID()
  unitId?: string | null;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
