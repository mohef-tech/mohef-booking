import { Controller, type MessageEvent, Query, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantSlug } from '../tenant/tenant-slug.decorator.js';
import { RealtimeEventsService } from './realtime-events.service.js';

@Controller('events')
export class RealtimeController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  @Sse('stream')
  async stream(
    @TenantSlug() headerSlug?: string,
    @Query('tenantSlug') querySlug?: string,
  ): Promise<Observable<MessageEvent>> {
    const tenant = await this.tenantContext.resolve(querySlug ?? headerSlug);
    return this.realtimeEvents.streamForTenant(tenant.id);
  }
}
