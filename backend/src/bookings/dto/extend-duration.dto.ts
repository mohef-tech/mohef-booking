import { IsIn, IsInt, Min } from 'class-validator';
import { PaymentMethod } from '../../generated/prisma/client.js';

export class ExtendDurationDto {
  @IsInt()
  @Min(30)
  extraMinutes: number;

  @IsIn([PaymentMethod.CASH, PaymentMethod.QRIS], {
    message: 'Metode pembayaran extend hanya mendukung CASH atau QRIS',
  })
  paymentMethod: 'CASH' | 'QRIS';
}
