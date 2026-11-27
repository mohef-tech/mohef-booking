import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import { PaymentMethod, UnitType } from '../../generated/prisma/client.js';

export class CreateWalkInBookingDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus berformat YYYY-MM-DD',
  })
  date?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime harus berformat HH:mm',
  })
  startTime?: string;

  @IsInt()
  @Min(30)
  durationMinutes: number;

  @IsOptional()
  @IsEnum(UnitType)
  unitType?: UnitType;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerWhatsapp?: string;

  @IsIn([PaymentMethod.CASH, PaymentMethod.QRIS], {
    message: 'Metode pembayaran walk-in hanya mendukung CASH atau QRIS',
  })
  paymentMethod: 'CASH' | 'QRIS';
}
