import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantSlug } from '../tenant/tenant-slug.decorator.js';
import { SimulatePaymentDto } from './dto/simulate-payment.dto.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post('simulate/verify')
  @HttpCode(HttpStatus.OK)
  async simulateVerify(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: SimulatePaymentDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.paymentsService.simulateVerify(tenant, dto);
  }

  @Post('simulate/expire')
  @HttpCode(HttpStatus.OK)
  async simulateExpire(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: SimulatePaymentDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.paymentsService.simulateExpire(tenant, dto);
  }
}
