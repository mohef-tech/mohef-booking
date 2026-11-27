import { IsIn, IsOptional } from 'class-validator';
import { PaymentMethod } from '../../generated/prisma/client.js';

export class CheckInBookingDto {
  @IsOptional()
  @IsIn([PaymentMethod.CASH, PaymentMethod.QRIS], {
    message: 'Metode pelunasan hanya mendukung CASH atau QRIS',
  })
  paymentMethod?: 'CASH' | 'QRIS';
}
