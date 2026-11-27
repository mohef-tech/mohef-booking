import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { BookingStatus } from '../../generated/prisma/client.js';

export class ListBookingsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus berformat YYYY-MM-DD',
  })
  date: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @IsOptional()
  @IsUUID()
  unitId?: string;
}
