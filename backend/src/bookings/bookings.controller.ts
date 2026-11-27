import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantSlug } from '../tenant/tenant-slug.decorator.js';
import { BookingOperationsService } from './booking-operations.service.js';
import { BookingsService } from './bookings.service.js';
import { AdminCancelDto } from './dto/admin-cancel.dto.js';
import { CheckInBookingDto } from './dto/check-in-booking.dto.js';
import { CreateChatBookingDto } from './dto/create-chat-booking.dto.js';
import { CreateOnlineBookingDto } from './dto/create-online-booking.dto.js';
import { CreateWalkInBookingDto } from './dto/create-walk-in-booking.dto.js';
import { ExtendDurationDto } from './dto/extend-duration.dto.js';
import { ExtendGraceDto } from './dto/extend-grace.dto.js';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto.js';
import { MoveUnitDto } from './dto/move-unit.dto.js';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto.js';
import { ResolveConflictDto } from './dto/resolve-conflict.dto.js';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly bookingsService: BookingsService,
    private readonly bookingOps: BookingOperationsService,
  ) {}

  @Post('online')
  async createOnline(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: CreateOnlineBookingDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingsService.createOnlineBooking(tenant, dto);
  }

  @Post('walk-in')
  async createWalkIn(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: CreateWalkInBookingDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingsService.createWalkInBooking(tenant, dto);
  }

  @Post('chat')
  async createChat(
    @TenantSlug() tenantSlug: string | undefined,
    @Body() dto: CreateChatBookingDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingsService.createChatBooking(tenant, dto);
  }

  @Get('public/:bookingCode')
  async getPublic(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('bookingCode') bookingCode: string,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingsService.getPublicByCode(tenant, bookingCode);
  }

  @Get()
  async listByDate(
    @TenantSlug() tenantSlug: string | undefined,
    @Query() query: ListBookingsQueryDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingsService.listByDate(tenant, query);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  async checkIn(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckInBookingDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.checkIn(tenant, id, dto);
  }

  @Post(':id/start-play')
  @HttpCode(HttpStatus.OK)
  async startPlay(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.startPlay(tenant, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.complete(tenant, id);
  }

  @Post(':id/extend-grace')
  @HttpCode(HttpStatus.OK)
  async extendGrace(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendGraceDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.extendGrace(tenant, id, dto);
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  async reschedule(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleBookingDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.reschedule(tenant, id, dto);
  }

  @Post(':id/extend-duration')
  @HttpCode(HttpStatus.OK)
  async extendDuration(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendDurationDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.extendDuration(tenant, id, dto);
  }

  @Post(':id/move-unit')
  @HttpCode(HttpStatus.OK)
  async moveUnit(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveUnitDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.moveUnit(tenant, id, dto);
  }

  @Post(':id/resolve-conflict')
  @HttpCode(HttpStatus.OK)
  async resolveConflict(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveConflictDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.resolveConflict(tenant, id, dto);
  }

  @Post(':id/admin-cancel')
  @HttpCode(HttpStatus.OK)
  async adminCancel(
    @TenantSlug() tenantSlug: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCancelDto,
  ) {
    const tenant = await this.tenantContext.resolve(tenantSlug);
    return this.bookingOps.adminCancel(tenant, id, dto);
  }
}
