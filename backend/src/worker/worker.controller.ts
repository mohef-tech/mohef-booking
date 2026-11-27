import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ClockService } from '../common/clock.service.js';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantSlug } from '../tenant/tenant-slug.decorator.js';
import {
  BookingAutomationService,
  type SweepSummary,
} from './booking-automation.service.js';
import { TriggerSweepDto } from './dto/trigger-sweep.dto.js';

@Controller('worker')
export class WorkerController {
  constructor(
    private readonly automation: BookingAutomationService,
    private readonly clock: ClockService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  async sweep(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: TriggerSweepDto,
  ): Promise<SweepSummary> {
    const referenceNow = dto.now ? new Date(dto.now) : this.clock.now();
    const tenantId = tenantSlug?.trim()
      ? (await this.tenantContext.resolve(tenantSlug)).id
      : undefined;
    return this.automation.runSweep(referenceNow, tenantId);
  }
}
