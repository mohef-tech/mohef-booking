import { Module } from '@nestjs/common';
import { BookingOperationsService } from './booking-operations.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, BookingOperationsService],
  exports: [BookingsService, BookingOperationsService],
})
export class BookingsModule {}
