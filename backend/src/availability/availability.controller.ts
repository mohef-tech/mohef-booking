import { Controller, Get, Query } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantSlug } from '../tenant/tenant-slug.decorator.js';
import {
  type AvailabilityCheckResponse,
  AvailabilityService,
  type CalendarAvailabilityResponse,
} from './availability.service.js';
import {
  CalendarQueryDto,
  CheckAvailabilityQueryDto,
} from './dto/availability-query.dto.js';

@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  @Get('calendar')
  async getCalendar(
    @TenantSlug() tenantSlug: string | undefined,
    @Query() query: CalendarQueryDto,
  ): Promise<CalendarAvailabilityResponse> {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.availabilityService.getCalendar(tenant, query);
  }

  @Get('check')
  async checkSlot(
    @TenantSlug() tenantSlug: string | undefined,
    @Query() query: CheckAvailabilityQueryDto,
  ): Promise<AvailabilityCheckResponse> {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.availabilityService.checkSlot(tenant, query);
  }
}
