import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import {
  PaymentMethod,
  PaymentType,
  UnitType,
} from '../../generated/prisma/client.js';

export class CreateChatBookingDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus berformat YYYY-MM-DD',
  })
  date: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime harus berformat HH:mm',
  })
  startTime: string;

  @IsInt()
  @Min(30)
  durationMinutes: number;

  @IsOptional()
  @IsEnum(UnitType)
  unitType?: UnitType;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  customerWhatsapp: string;

  @IsIn([PaymentType.DP, PaymentType.DIRECT_FULL], {
    message: 'Tipe pembayaran chat hanya mendukung DP atau DIRECT_FULL',
  })
  paymentType: 'DP' | 'DIRECT_FULL';

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
