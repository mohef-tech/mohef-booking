import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AvailabilityModule } from './availability/availability.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ClockModule } from './common/clock.module.js';
import { HealthModule } from './health/health.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { WorkerModule } from './worker/worker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ClockModule,
    PrismaModule,
    TenantModule,
    RealtimeModule,
    HealthModule,
    CatalogModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    WorkerModule,
  ],
})
export class AppModule {}
