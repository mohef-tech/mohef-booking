import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  getJakartaDayBounds,
  parseTimeToMinutes,
} from '../common/time-slot.util.js';
import type {
  RateRule,
  ScheduleBlock,
  Tenant,
  Unit,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateScheduleBlockDto,
  ListScheduleBlocksQueryDto,
} from './dto/schedule-block.dto.js';
import type {
  CreateUnitDto,
  ListUnitsQueryDto,
  UpdateUnitDto,
} from './dto/unit.dto.js';
import type { UpdateRateRulesDto } from './dto/update-rate-rules.dto.js';
import type { UpdateSettingsDto } from './dto/update-settings.dto.js';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  getSettings(tenant: Tenant): Tenant {
    return tenant;
  }

  async updateSettings(
    tenant: Tenant,
    dto: UpdateSettingsDto,
  ): Promise<Tenant> {
    const nextOpenTime = dto.openTime ?? tenant.openTime;
    const nextCloseTime = dto.closeTime ?? tenant.closeTime;
    const openMinutes = parseTimeToMinutes(nextOpenTime);
    const closeMinutes = parseTimeToMinutes(nextCloseTime, {
      allowEndOfDay: true,
    });

    if (closeMinutes <= openMinutes) {
      throw new BadRequestException(
        'Jam tutup (closeTime) harus lebih akhir dari jam buka (openTime)',
      );
    }

    return this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.openTime !== undefined ? { openTime: dto.openTime } : {}),
        ...(dto.closeTime !== undefined ? { closeTime: dto.closeTime } : {}),
        ...(dto.dpHoldMinutes !== undefined
          ? { dpHoldMinutes: dto.dpHoldMinutes }
          : {}),
        ...(dto.gracePeriodMinutes !== undefined
          ? { gracePeriodMinutes: dto.gracePeriodMinutes }
          : {}),
        ...(dto.maxGraceExtensionMinutes !== undefined
          ? { maxGraceExtensionMinutes: dto.maxGraceExtensionMinutes }
          : {}),
      },
    });
  }

  async listUnits(tenant: Tenant, query: ListUnitsQueryDto): Promise<Unit[]> {
    return this.prisma.unit.findMany({
      where: {
        tenantId: tenant.id,
        ...(query.type !== undefined ? { type: query.type } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  async createUnit(tenant: Tenant, dto: CreateUnitDto): Promise<Unit> {
    const code = dto.code.trim();
    const existing = await this.prisma.unit.findUnique({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Kode unit "${code}" sudah digunakan`);
    }

    return this.prisma.unit.create({
      data: {
        tenantId: tenant.id,
        code,
        name: dto.name.trim(),
        type: dto.type,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateUnit(
    tenant: Tenant,
    unitId: string,
    dto: UpdateUnitDto,
  ): Promise<Unit> {
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, tenantId: tenant.id },
    });

    if (!unit) {
      throw new NotFoundException('Unit tidak ditemukan');
    }

    const nextCode = dto.code?.trim();
    if (nextCode && nextCode !== unit.code) {
      const duplicate = await this.prisma.unit.findUnique({
        where: {
          tenantId_code: {
            tenantId: tenant.id,
            code: nextCode,
          },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Kode unit "${nextCode}" sudah digunakan`);
      }
    }

    if (dto.isActive === false) {
      const activeBookingCount = await this.prisma.booking.count({
        where: {
          tenantId: tenant.id,
          unitId: unit.id,
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
        },
      });

      if (activeBookingCount > 0) {
        throw new ConflictException(
          'Unit tidak dapat dinonaktifkan karena masih memiliki booking aktif',
        );
      }
    }

    return this.prisma.unit.update({
      where: { id: unit.id },
      data: {
        ...(nextCode !== undefined ? { code: nextCode } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async listRateRules(tenant: Tenant): Promise<RateRule[]> {
    return this.prisma.rateRule.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ unitType: 'asc' }, { dayCategory: 'asc' }],
    });
  }

  async updateRateRules(
    tenant: Tenant,
    dto: UpdateRateRulesDto,
  ): Promise<RateRule[]> {
    const seen = new Set<string>();
    for (const rule of dto.rules) {
      const key = `${rule.unitType}:${rule.dayCategory}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          `Duplikasi kombinasi tarif untuk ${rule.unitType} - ${rule.dayCategory}`,
        );
      }
      seen.add(key);
    }

    await this.prisma.$transaction(
      dto.rules.map((rule) =>
        this.prisma.rateRule.upsert({
          where: {
            tenantId_unitType_dayCategory: {
              tenantId: tenant.id,
              unitType: rule.unitType,
              dayCategory: rule.dayCategory,
            },
          },
          update: {
            hourlyRate: rule.hourlyRate,
          },
          create: {
            tenantId: tenant.id,
            unitType: rule.unitType,
            dayCategory: rule.dayCategory,
            hourlyRate: rule.hourlyRate,
          },
        }),
      ),
    );

    return this.listRateRules(tenant);
  }

  async listScheduleBlocks(
    tenant: Tenant,
    query: ListScheduleBlocksQueryDto,
  ): Promise<
    Array<
      ScheduleBlock & {
        unit: Pick<Unit, 'id' | 'code' | 'name' | 'type'> | null;
      }
    >
  > {
    const dateFilter = query.date ? getJakartaDayBounds(query.date) : null;

    return this.prisma.scheduleBlock.findMany({
      where: {
        tenantId: tenant.id,
        ...(query.unitId !== undefined ? { unitId: query.unitId } : {}),
        ...(dateFilter
          ? {
              startAt: { lt: dateFilter.dayEnd },
              endAt: { gt: dateFilter.dayStart },
            }
          : {}),
      },
      include: {
        unit: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async createScheduleBlock(
    tenant: Tenant,
    dto: CreateScheduleBlockDto,
  ): Promise<ScheduleBlock> {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Format startAt atau endAt tidak valid');
    }

    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException(
        'Waktu selesai blokir (endAt) harus lebih akhir dari waktu mulai (startAt)',
      );
    }

    const unitId = dto.unitId ?? null;
    if (unitId !== null) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: unitId, tenantId: tenant.id },
      });
      if (!unit) {
        throw new NotFoundException('Unit tidak ditemukan');
      }
    }

    const conflictingBookings = await this.prisma.booking.findMany({
      where: {
        tenantId: tenant.id,
        ...(unitId !== null ? { unitId } : {}),
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: {
        id: true,
        bookingCode: true,
        unitId: true,
        startAt: true,
        endAt: true,
      },
      take: 5,
    });

    if (conflictingBookings.length > 0) {
      const codes = conflictingBookings.map((b) => b.bookingCode).join(', ');
      throw new ConflictException(
        `Blokir jadwal bertabrakan dengan booking aktif: ${codes}`,
      );
    }

    return this.prisma.scheduleBlock.create({
      data: {
        tenantId: tenant.id,
        unitId,
        startAt,
        endAt,
        reason: dto.reason.trim(),
      },
    });
  }

  async deleteScheduleBlock(
    tenant: Tenant,
    blockId: string,
  ): Promise<{ deleted: true; id: string }> {
    const block = await this.prisma.scheduleBlock.findFirst({
      where: { id: blockId, tenantId: tenant.id },
    });

    if (!block) {
      throw new NotFoundException('Blokir jadwal tidak ditemukan');
    }

    await this.prisma.scheduleBlock.delete({
      where: { id: block.id },
    });

    return { deleted: true, id: block.id };
  }
}
