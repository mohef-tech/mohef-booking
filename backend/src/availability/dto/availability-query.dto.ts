import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import { UnitType } from '../../generated/prisma/client.js';

export class CalendarQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus berformat YYYY-MM-DD',
  })
  date: string;
}

export class CheckAvailabilityQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus berformat YYYY-MM-DD',
  })
  date: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime harus berformat HH:mm',
  })
  startTime: string;

  @Type(() => Number)
  @IsInt({ message: 'durationMinutes harus berupa bilangan bulat' })
  @Min(30, { message: 'Durasi pemesanan minimal 30 menit' })
  durationMinutes: number;

  @IsOptional()
  @IsEnum(UnitType)
  unitType?: UnitType;

  @IsOptional()
  @IsUUID()
  unitId?: string;
}
