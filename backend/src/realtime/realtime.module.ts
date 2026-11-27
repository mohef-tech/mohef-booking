import { Global, Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeEventsService } from './realtime-events.service.js';

@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeEventsService],
  exports: [RealtimeEventsService],
})
export class RealtimeModule {}
