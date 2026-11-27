import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantSlug } from '../tenant/tenant-slug.decorator.js';
import { CatalogService } from './catalog.service.js';
import {
  CreateScheduleBlockDto,
  ListScheduleBlocksQueryDto,
} from './dto/schedule-block.dto.js';
import {
  CreateUnitDto,
  ListUnitsQueryDto,
  UpdateUnitDto,
} from './dto/unit.dto.js';
import { UpdateRateRulesDto } from './dto/update-rate-rules.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

@Controller()
export class CatalogController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly catalogService: CatalogService,
  ) {}

  @Get('settings')
  async getSettings(@TenantSlug() tenantSlug?: string) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.getSettings(tenant);
  }

  @Patch('settings')
  async updateSettings(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: UpdateSettingsDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.updateSettings(tenant, dto);
  }

  @Get('units')
  async listUnits(
    @TenantSlug() tenantSlug: string | undefined,
    @Query() query: ListUnitsQueryDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.listUnits(tenant, query);
  }

  @Post('units')
  async createUnit(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: CreateUnitDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.createUnit(tenant, dto);
  }

  @Patch('units/:id')
  async updateUnit(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.updateUnit(tenant, id, dto);
  }

  @Get('rate-rules')
  async listRateRules(@TenantSlug() tenantSlug?: string) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.listRateRules(tenant);
  }

  @Put('rate-rules')
  async updateRateRules(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: UpdateRateRulesDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.updateRateRules(tenant, dto);
  }

  @Get('schedule-blocks')
  async listScheduleBlocks(
    @TenantSlug() tenantSlug: string | undefined,
    @Query() query: ListScheduleBlocksQueryDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.listScheduleBlocks(tenant, query);
  }

  @Post('schedule-blocks')
  async createScheduleBlock(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: CreateScheduleBlockDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.createScheduleBlock(tenant, dto);
  }

  @Delete('schedule-blocks/:id')
  async deleteScheduleBlock(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.catalogService.deleteScheduleBlock(tenant, id);
  }
}
