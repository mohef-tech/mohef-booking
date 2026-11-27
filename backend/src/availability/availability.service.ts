import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  calculateSlotPricing,
  detectJakartaDayCategory,
  getJakartaDayBounds,
  intervalsOverlap,
  JAKARTA_TIMEZONE,
  SLOT_INTERVAL_MINUTES,
  type SlotPricingBreakdown,
  validateSlotGridAndOperatingHours,
} from '../common/time-slot.util.js';
import type {
  BookingStatus,
  DayCategory,
  Tenant,
  UnitType,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CalendarQueryDto,
  CheckAvailabilityQueryDto,
} from './dto/availability-query.dto.js';

export interface AvailableUnitSummary {
  id: string;
  code: string;
  name: string;
  type: UnitType;
}

export type OccupiedInterval =
  | {
      kind: 'BOOKING';
      id: string;
      unitId: string;
      startAt: string;
      endAt: string;
      status: BookingStatus;
      bookingCode: string;
    }
  | {
      kind: 'SCHEDULE_BLOCK';
      id: string;
      unitId: string | null;
      startAt: string;
      endAt: string;
      reason: string;
    };

export interface CalendarAvailabilityResponse {
  date: string;
  timezone: string;
  dayCategory: DayCategory;
  operatingHours: {
    openTime: string;
    closeTime: string;
    slotIntervalMinutes: number;
  };
  rates: Array<{
    unitType: UnitType;
    dayCategory: DayCategory;
    hourlyRate: number;
  }>;
  units: AvailableUnitSummary[];
  occupiedIntervals: OccupiedInterval[];
}

export interface AvailabilityCheckResponse {
  available: boolean;
  date: string;
  timezone: string;
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  unitType: UnitType;
  requestedUnitId: string | null;
  availableUnits: AvailableUnitSummary[];
  unavailableReason: string | null;
  pricing: SlotPricingBreakdown;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getCalendar(
    tenant: Tenant,
    query: CalendarQueryDto,
  ): Promise<CalendarAvailabilityResponse> {
    const { dayStart, dayEnd } = getJakartaDayBounds(query.date);
    const dayCategory = detectJakartaDayCategory(query.date);

    const [units, rateRules, bookings, blocks] = await Promise.all([
      this.prisma.unit.findMany({
        where: { tenantId: tenant.id, isActive: true },
        select: { id: true, code: true, name: true, type: true },
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.rateRule.findMany({
        where: { tenantId: tenant.id, dayCategory },
        select: { unitType: true, dayCategory: true, hourlyRate: true },
        orderBy: { unitType: 'asc' },
      }),
      this.prisma.booking.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: {
          id: true,
          unitId: true,
          startAt: true,
          endAt: true,
          status: true,
          bookingCode: true,
        },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.scheduleBlock.findMany({
        where: {
          tenantId: tenant.id,
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: {
          id: true,
          unitId: true,
          startAt: true,
          endAt: true,
          reason: true,
        },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    const occupiedIntervals: OccupiedInterval[] = [
      ...bookings.map(
        (b): OccupiedInterval => ({
          kind: 'BOOKING',
          id: b.id,
          unitId: b.unitId,
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          status: b.status,
          bookingCode: b.bookingCode,
        }),
      ),
      ...blocks.map(
        (block): OccupiedInterval => ({
          kind: 'SCHEDULE_BLOCK',
          id: block.id,
          unitId: block.unitId,
          startAt: block.startAt.toISOString(),
          endAt: block.endAt.toISOString(),
          reason: block.reason,
        }),
      ),
    ].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );

    return {
      date: query.date,
      timezone: JAKARTA_TIMEZONE,
      dayCategory,
      operatingHours: {
        openTime: tenant.openTime,
        closeTime: tenant.closeTime,
        slotIntervalMinutes: SLOT_INTERVAL_MINUTES,
      },
      rates: rateRules,
      units,
      occupiedIntervals,
    };
  }

  async checkSlot(
    tenant: Tenant,
    query: CheckAvailabilityQueryDto,
  ): Promise<AvailabilityCheckResponse> {
    if (!query.unitId && !query.unitType) {
      throw new BadRequestException(
        'Parameter unitType atau unitId wajib diisi',
      );
    }

    const { startAt, endAt, endTime } = validateSlotGridAndOperatingHours({
      date: query.date,
      startTime: query.startTime,
      durationMinutes: query.durationMinutes,
      openTime: tenant.openTime,
      closeTime: tenant.closeTime,
    });

    const dayCategory = detectJakartaDayCategory(query.date);

    let candidateUnits: AvailableUnitSummary[];
    let resolvedUnitType: UnitType;

    if (query.unitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: query.unitId, tenantId: tenant.id },
        select: { id: true, code: true, name: true, type: true, isActive: true },
      });

      if (!unit) {
        throw new NotFoundException('Unit tidak ditemukan');
      }
      if (!unit.isActive) {
        throw new BadRequestException(`Unit "${unit.code}" sedang nonaktif`);
      }
      if (query.unitType && unit.type !== query.unitType) {
        throw new BadRequestException(
          `Unit "${unit.code}" bertipe ${unit.type}, tidak sesuai dengan unitType ${query.unitType}`,
        );
      }

      resolvedUnitType = unit.type;
      candidateUnits = [
        { id: unit.id, code: unit.code, name: unit.name, type: unit.type },
      ];
    } else {
      resolvedUnitType = query.unitType!;
      candidateUnits = await this.prisma.unit.findMany({
        where: {
          tenantId: tenant.id,
          type: resolvedUnitType,
          isActive: true,
        },
        select: { id: true, code: true, name: true, type: true },
        orderBy: { code: 'asc' },
      });
    }

    const rateRule = await this.prisma.rateRule.findUnique({
      where: {
        tenantId_unitType_dayCategory: {
          tenantId: tenant.id,
          unitType: resolvedUnitType,
          dayCategory,
        },
      },
    });

    if (!rateRule) {
      throw new NotFoundException(
        `Tarif untuk ${resolvedUnitType} (${dayCategory}) belum dikonfigurasi`,
      );
    }

    const pricing = calculateSlotPricing(
      rateRule.hourlyRate,
      query.durationMinutes,
      dayCategory,
    );

    if (candidateUnits.length === 0) {
      return {
        available: false,
        date: query.date,
        timezone: JAKARTA_TIMEZONE,
        startTime: query.startTime,
        endTime,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        durationMinutes: query.durationMinutes,
        unitType: resolvedUnitType,
        requestedUnitId: query.unitId ?? null,
        availableUnits: [],
        unavailableReason: `Tidak ada unit aktif bertipe ${resolvedUnitType}`,
        pricing,
      };
    }

    const candidateIds = candidateUnits.map((unit) => unit.id);
    const [overlappingBookings, overlappingBlocks] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          tenantId: tenant.id,
          unitId: { in: candidateIds },
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { unitId: true, startAt: true, endAt: true },
      }),
      this.prisma.scheduleBlock.findMany({
        where: {
          tenantId: tenant.id,
          OR: [{ unitId: null }, { unitId: { in: candidateIds } }],
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { unitId: true, startAt: true, endAt: true, reason: true },
      }),
    ]);

    const venueWideBlock = overlappingBlocks.find(
      (block) =>
        block.unitId === null &&
        intervalsOverlap(startAt, endAt, block.startAt, block.endAt),
    );

    if (venueWideBlock) {
      return {
        available: false,
        date: query.date,
        timezone: JAKARTA_TIMEZONE,
        startTime: query.startTime,
        endTime,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        durationMinutes: query.durationMinutes,
        unitType: resolvedUnitType,
        requestedUnitId: query.unitId ?? null,
        availableUnits: [],
        unavailableReason: `Seluruh tempat sedang diblokir: ${venueWideBlock.reason}`,
        pricing,
      };
    }

    const busyUnitIds = new Set<string>();
    for (const booking of overlappingBookings) {
      if (intervalsOverlap(startAt, endAt, booking.startAt, booking.endAt)) {
        busyUnitIds.add(booking.unitId);
      }
    }

    const blockedUnitReasons = new Map<string, string>();
    for (const block of overlappingBlocks) {
      if (
        block.unitId !== null &&
        intervalsOverlap(startAt, endAt, block.startAt, block.endAt)
      ) {
        busyUnitIds.add(block.unitId);
        blockedUnitReasons.set(block.unitId, block.reason);
      }
    }

    const availableUnits = candidateUnits.filter(
      (unit) => !busyUnitIds.has(unit.id),
    );

    let unavailableReason: string | null = null;
    if (availableUnits.length === 0) {
      if (query.unitId && blockedUnitReasons.has(query.unitId)) {
        unavailableReason = `Unit sedang diblokir: ${blockedUnitReasons.get(query.unitId)}`;
      } else if (query.unitId) {
        unavailableReason = 'Unit sudah terisi pada rentang waktu tersebut';
      } else {
        unavailableReason = `Semua unit ${resolvedUnitType} sudah terisi pada rentang waktu tersebut`;
      }
    }

    return {
      available: availableUnits.length > 0,
      date: query.date,
      timezone: JAKARTA_TIMEZONE,
      startTime: query.startTime,
      endTime,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      durationMinutes: query.durationMinutes,
      unitType: resolvedUnitType,
      requestedUnitId: query.unitId ?? null,
      availableUnits,
      unavailableReason,
      pricing,
    };
  }
}
