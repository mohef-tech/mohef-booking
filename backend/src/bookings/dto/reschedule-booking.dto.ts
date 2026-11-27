import { IsOptional, IsUUID, Matches } from 'class-validator';

export class RescheduleBookingDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus berformat YYYY-MM-DD',
  })
  date: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime harus berformat HH:mm',
  })
  startTime: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;
}
