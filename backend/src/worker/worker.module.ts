import { Module } from '@nestjs/common';
import { BookingAutomationService } from './booking-automation.service.js';
import { WorkerController } from './worker.controller.js';

@Module({
  controllers: [WorkerController],
  providers: [BookingAutomationService],
  exports: [BookingAutomationService],
})
export class WorkerModule {}
