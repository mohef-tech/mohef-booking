import { IsOptional, IsString, IsUUID } from 'class-validator';

export class SimulatePaymentDto {
  @IsOptional()
  @IsString()
  bookingCode?: string;

  @IsOptional()
  @IsUUID()
  paymentId?: string;
}
