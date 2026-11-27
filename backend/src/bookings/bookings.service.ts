import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateBookingCode } from '../common/booking-code.util.js';
import { ClockService } from '../common/clock.service.js';
import {
  isExclusionConstraintError,
  isUniqueConstraintError,
} from '../common/prisma-error.util.js';
import {
  ACTIVE_BOOKING_STATUSES,
  buildJakartaBookingInterval,
  calculateSlotPricing,
  detectJakartaDayCategory,
  getCurrentJakartaSlot,
  getJakartaDayBounds,
  intervalsOverlap,
} from '../common/time-slot.util.js';
import {
  ActorRole,
  BookingPaymentStatus,
  BookingSource,
  BookingStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentTransactionStatus,
  PaymentType,
  type Prisma,
  type Tenant,
  type UnitType,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeEventsService } from '../realtime/realtime-events.service.js';
import {
  attachRemainingAmount,
  BOOKING_DETAIL_INCLUDE,
  buildRealtimeBookingEvent,
  type BookingDetailResponse,
} from './booking.constants.js';
import type { CreateChatBookingDto } from './dto/create-chat-booking.dto.js';
import type { CreateOnlineBookingDto } from './dto/create-online-booking.dto.js';
import type { CreateWalkInBookingDto } from './dto/create-walk-in-booking.dto.js';
import type { ListBookingsQueryDto } from './dto/list-bookings-query.dto.js';

export type { BookingDetailResponse };

const MAX_CODE_RETRIES = 5;

interface ResolvedCandidate {
  unitType: UnitType;
  candidateUnitIds: string[];
  isSpecificUnit: boolean;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  async createOnlineBooking(
    tenant: Tenant,
    dto: CreateOnlineBookingDto,
  ): Promise<BookingDetailResponse> {
    const now = this.clock.now();
    const interval = buildJakartaBookingInterval({
      date: dto.date,
      startTime: dto.startTime,
      durationMinutes: dto.durationMinutes,
      openTime: tenant.openTime,
      closeTime: tenant.closeTime,
      gracePeriodMinutes: tenant.gracePeriodMinutes,
    });

    const currentSlot = getCurrentJakartaSlot(now);
    if (interval.startAt.getTime() < currentSlot.startAt.getTime()) {
      throw new BadRequestException(
        'Tidak dapat membuat booking pada jadwal yang sudah berlalu',
      );
    }

    const dayCategory = detectJakartaDayCategory(dto.date);
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.QRIS;
    const expiresAt = new Date(now.getTime() + tenant.dpHoldMinutes * 60_000);

    return this.executeBookingCreation(
      tenant,
      {
        unitId: dto.unitId,
        unitType: dto.unitType,
        startAt: interval.startAt,
        endAt: interval.endAt,
        effectiveCheckinDeadline: interval.effectiveCheckinDeadline,
        dayCategory,
        durationMinutes: dto.durationMinutes,
      },
      async (tx, unitId, pricing, bookingCode) => {
        const booking = await tx.booking.create({
          data: {
            tenantId: tenant.id,
            unitId,
            bookingCode,
            source: BookingSource.ONLINE,
            customerName: dto.customerName.trim(),
            customerWhatsapp: dto.customerWhatsapp.trim(),
            startAt: interval.startAt,
            endAt: interval.endAt,
            effectiveCheckinDeadline: interval.effectiveCheckinDeadline,
            status: BookingStatus.HOLD_DP,
            totalAmount: pricing.totalAmount,
            dpAmount: pricing.dpAmount,
            paidAmount: 0,
            paymentStatus: BookingPaymentStatus.UNPAID,
            payments: {
              create: {
                tenantId: tenant.id,
                provider: PaymentProvider.SIMULATOR,
                method: paymentMethod,
                type: PaymentType.DP,
                amount: pricing.dpAmount,
                status: PaymentTransactionStatus.PENDING,
                expiresAt,
              },
            },
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'BOOKING_CREATED_HOLD_DP',
                actorRole: ActorRole.CUSTOMER,
                notes: `Booking online dibuat (${paymentMethod}), DP Rp ${pricing.dpAmount} ditahan selama ${tenant.dpHoldMinutes} menit`,
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        this.realtimeEvents.emit(
          buildRealtimeBookingEvent(
            'BOOKING_CREATED',
            booking,
            now,
            `Booking online baru (${booking.unit.code}) menunggu DP`,
          ),
        );

        return attachRemainingAmount(booking);
      },
    );
  }

  async createWalkInBooking(
    tenant: Tenant,
    dto: CreateWalkInBookingDto,
  ): Promise<BookingDetailResponse> {
    const now = this.clock.now();
    const currentSlot = getCurrentJakartaSlot(now);

    if ((dto.date && !dto.startTime) || (!dto.date && dto.startTime)) {
      throw new BadRequestException(
        'Parameter date dan startTime harus diisi berpasangan atau dikosongkan keduanya',
      );
    }

    const targetDate = dto.date ?? currentSlot.date;
    const targetStartTime = dto.startTime ?? currentSlot.startTime;

    const interval = buildJakartaBookingInterval({
      date: targetDate,
      startTime: targetStartTime,
      durationMinutes: dto.durationMinutes,
      openTime: tenant.openTime,
      closeTime: tenant.closeTime,
      gracePeriodMinutes: tenant.gracePeriodMinutes,
    });

    if (interval.startAt.getTime() !== currentSlot.startAt.getTime()) {
      throw new BadRequestException(
        'Walk-in hanya diperbolehkan untuk sesi berjalan saat ini. Untuk jadwal mendatang, gunakan jalur booking online atau chat.',
      );
    }

    const dayCategory = detectJakartaDayCategory(targetDate);
    const provider =
      dto.paymentMethod === PaymentMethod.CASH
        ? PaymentProvider.CASH
        : PaymentProvider.SIMULATOR;

    return this.executeBookingCreation(
      tenant,
      {
        unitId: dto.unitId,
        unitType: dto.unitType,
        startAt: interval.startAt,
        endAt: interval.endAt,
        effectiveCheckinDeadline: interval.effectiveCheckinDeadline,
        dayCategory,
        durationMinutes: dto.durationMinutes,
      },
      async (tx, unitId, pricing, bookingCode) => {
        const booking = await tx.booking.create({
          data: {
            tenantId: tenant.id,
            unitId,
            bookingCode,
            source: BookingSource.WALK_IN,
            customerName: dto.customerName?.trim() || null,
            customerWhatsapp: dto.customerWhatsapp?.trim() || null,
            startAt: interval.startAt,
            endAt: interval.endAt,
            effectiveCheckinDeadline: interval.effectiveCheckinDeadline,
            status: BookingStatus.CONFIRMED,
            totalAmount: pricing.totalAmount,
            dpAmount: 0,
            paidAmount: pricing.totalAmount,
            paymentStatus: BookingPaymentStatus.PAID,
            payments: {
              create: {
                tenantId: tenant.id,
                provider,
                method: dto.paymentMethod,
                type: PaymentType.DIRECT_FULL,
                amount: pricing.totalAmount,
                status: PaymentTransactionStatus.VERIFIED,
                verifiedAt: now,
              },
            },
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'WALK_IN_BOOKING_CONFIRMED',
                actorRole: ActorRole.CASHIER,
                notes: `Walk-in lunas di muka Rp ${pricing.totalAmount} (${dto.paymentMethod})`,
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        this.realtimeEvents.emit(
          buildRealtimeBookingEvent(
            'BOOKING_CREATED',
            booking,
            now,
            `Walk-in lunas (${booking.unit.code})`,
          ),
        );

        return attachRemainingAmount(booking);
      },
    );
  }

  async createChatBooking(
    tenant: Tenant,
    dto: CreateChatBookingDto,
  ): Promise<BookingDetailResponse> {
    const now = this.clock.now();
    const interval = buildJakartaBookingInterval({
      date: dto.date,
      startTime: dto.startTime,
      durationMinutes: dto.durationMinutes,
      openTime: tenant.openTime,
      closeTime: tenant.closeTime,
      gracePeriodMinutes: tenant.gracePeriodMinutes,
    });

    const currentSlot = getCurrentJakartaSlot(now);
    if (interval.startAt.getTime() < currentSlot.startAt.getTime()) {
      throw new BadRequestException(
        'Tidak dapat membuat booking pada jadwal yang sudah berlalu',
      );
    }

    const dayCategory = detectJakartaDayCategory(dto.date);
    const provider =
      dto.paymentMethod === PaymentMethod.CASH
        ? PaymentProvider.CASH
        : PaymentProvider.SIMULATOR;

    return this.executeBookingCreation(
      tenant,
      {
        unitId: dto.unitId,
        unitType: dto.unitType,
        startAt: interval.startAt,
        endAt: interval.endAt,
        effectiveCheckinDeadline: interval.effectiveCheckinDeadline,
        dayCategory,
        durationMinutes: dto.durationMinutes,
      },
      async (tx, unitId, pricing, bookingCode) => {
        const isFull = dto.paymentType === PaymentType.DIRECT_FULL;
        const paidAmount = isFull ? pricing.totalAmount : pricing.dpAmount;
        const paymentStatus = isFull
          ? BookingPaymentStatus.PAID
          : BookingPaymentStatus.DP_PAID;

        const booking = await tx.booking.create({
          data: {
            tenantId: tenant.id,
            unitId,
            bookingCode,
            source: BookingSource.CHAT,
            customerName: dto.customerName.trim(),
            customerWhatsapp: dto.customerWhatsapp.trim(),
            startAt: interval.startAt,
            endAt: interval.endAt,
            effectiveCheckinDeadline: interval.effectiveCheckinDeadline,
            status: BookingStatus.CONFIRMED,
            totalAmount: pricing.totalAmount,
            dpAmount: pricing.dpAmount,
            paidAmount,
            paymentStatus,
            payments: {
              create: {
                tenantId: tenant.id,
                provider,
                method: dto.paymentMethod,
                type: dto.paymentType,
                amount: paidAmount,
                status: PaymentTransactionStatus.VERIFIED,
                verifiedAt: now,
              },
            },
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'CHAT_BOOKING_CONFIRMED',
                actorRole: ActorRole.CASHIER,
                notes: `Booking chat terverifikasi (${dto.paymentType} Rp ${paidAmount} via ${dto.paymentMethod})`,
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        this.realtimeEvents.emit(
          buildRealtimeBookingEvent(
            'BOOKING_CREATED',
            booking,
            now,
            `Booking chat baru (${booking.unit.code})`,
          ),
        );

        return attachRemainingAmount(booking);
      },
    );
  }

  async getPublicByCode(
    tenant: Tenant,
    bookingCode: string,
  ): Promise<BookingDetailResponse> {
    const normalizedCode = bookingCode.trim().toUpperCase();
    const booking = await this.prisma.booking.findFirst({
      where: {
        tenantId: tenant.id,
        bookingCode: normalizedCode,
      },
      include: BOOKING_DETAIL_INCLUDE,
    });

    if (!booking) {
      throw new NotFoundException(
        `Booking dengan kode "${normalizedCode}" tidak ditemukan`,
      );
    }

    return attachRemainingAmount(booking);
  }

  async listByDate(tenant: Tenant, query: ListBookingsQueryDto) {
    const { dayStart, dayEnd } = getJakartaDayBounds(query.date);

    const bookings = await this.prisma.booking.findMany({
      where: {
        tenantId: tenant.id,
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.unitId !== undefined ? { unitId: query.unitId } : {}),
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
        payments: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { startAt: 'asc' },
    });

    return bookings.map((booking) => ({
      ...booking,
      remainingAmount: Math.max(0, booking.totalAmount - booking.paidAmount),
    }));
  }

  private async executeBookingCreation(
    tenant: Tenant,
    slotInput: {
      unitId?: string;
      unitType?: UnitType;
      startAt: Date;
      endAt: Date;
      effectiveCheckinDeadline: Date;
      dayCategory: ReturnType<typeof detectJakartaDayCategory>;
      durationMinutes: number;
    },
    persist: (
      tx: Prisma.TransactionClient,
      unitId: string,
      pricing: ReturnType<typeof calculateSlotPricing>,
      bookingCode: string,
    ) => Promise<BookingDetailResponse>,
  ): Promise<BookingDetailResponse> {
    const candidate = await this.resolveCandidateUnits(
      tenant,
      slotInput.unitId,
      slotInput.unitType,
    );

    const rateRule = await this.prisma.rateRule.findUnique({
      where: {
        tenantId_unitType_dayCategory: {
          tenantId: tenant.id,
          unitType: candidate.unitType,
          dayCategory: slotInput.dayCategory,
        },
      },
    });

    if (!rateRule) {
      throw new NotFoundException(
        `Tarif untuk ${candidate.unitType} (${slotInput.dayCategory}) belum dikonfigurasi`,
      );
    }

    const pricing = calculateSlotPricing(
      rateRule.hourlyRate,
      slotInput.durationMinutes,
      slotInput.dayCategory,
    );

    const availableUnitIds = await this.filterAvailableUnits(
      tenant.id,
      candidate.candidateUnitIds,
      slotInput.startAt,
      slotInput.endAt,
      candidate.isSpecificUnit,
    );

    for (const unitId of availableUnitIds) {
      for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt += 1) {
        const bookingCode = generateBookingCode();
        try {
          return await this.prisma.$transaction(async (tx) => {
            await this.assertNoScheduleBlockConflict(
              tx,
              tenant.id,
              unitId,
              slotInput.startAt,
              slotInput.endAt,
            );
            return persist(tx, unitId, pricing, bookingCode);
          });
        } catch (error) {
          if (isUniqueConstraintError(error) && attempt < MAX_CODE_RETRIES - 1) {
            continue;
          }
          if (isExclusionConstraintError(error)) {
            if (candidate.isSpecificUnit) {
              throw new ConflictException(
                'Slot pada unit yang dipilih sudah terisi pada rentang waktu tersebut',
              );
            }
            // Auto-allocation: try next candidate unit if concurrent write took this one
            break;
          }
          throw error;
        }
      }
    }

    throw new ConflictException(
      `Semua unit ${candidate.unitType} sudah terisi pada rentang waktu tersebut`,
    );
  }

  private async resolveCandidateUnits(
    tenant: Tenant,
    unitId?: string,
    unitType?: UnitType,
  ): Promise<ResolvedCandidate> {
    if (!unitId && !unitType) {
      throw new BadRequestException(
        'Parameter unitType atau unitId wajib diisi',
      );
    }

    if (unitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: unitId, tenantId: tenant.id },
        select: { id: true, code: true, type: true, isActive: true },
      });

      if (!unit) {
        throw new NotFoundException('Unit tidak ditemukan');
      }
      if (!unit.isActive) {
        throw new BadRequestException(`Unit "${unit.code}" sedang nonaktif`);
      }
      if (unitType && unit.type !== unitType) {
        throw new BadRequestException(
          `Unit "${unit.code}" bertipe ${unit.type}, tidak sesuai dengan unitType ${unitType}`,
        );
      }

      return {
        unitType: unit.type,
        candidateUnitIds: [unit.id],
        isSpecificUnit: true,
      };
    }

    const units = await this.prisma.unit.findMany({
      where: {
        tenantId: tenant.id,
        type: unitType,
        isActive: true,
      },
      select: { id: true },
      orderBy: { code: 'asc' },
    });

    if (units.length === 0) {
      throw new ConflictException(`Tidak ada unit aktif bertipe ${unitType}`);
    }

    return {
      unitType: unitType!,
      candidateUnitIds: units.map((u) => u.id),
      isSpecificUnit: false,
    };
  }

  private async filterAvailableUnits(
    tenantId: string,
    candidateUnitIds: string[],
    startAt: Date,
    endAt: Date,
    isSpecificUnit: boolean,
  ): Promise<string[]> {
    const [overlappingBookings, overlappingBlocks] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          tenantId,
          unitId: { in: candidateUnitIds },
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { unitId: true, startAt: true, endAt: true },
      }),
      this.prisma.scheduleBlock.findMany({
        where: {
          tenantId,
          OR: [{ unitId: null }, { unitId: { in: candidateUnitIds } }],
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { unitId: true, startAt: true, endAt: true, reason: true },
      }),
    ]);

    const venueBlock = overlappingBlocks.find(
      (block) =>
        block.unitId === null &&
        intervalsOverlap(startAt, endAt, block.startAt, block.endAt),
    );
    if (venueBlock) {
      throw new ConflictException(
        `Seluruh tempat sedang diblokir: ${venueBlock.reason}`,
      );
    }

    const busyIds = new Set<string>();
    for (const booking of overlappingBookings) {
      if (intervalsOverlap(startAt, endAt, booking.startAt, booking.endAt)) {
        busyIds.add(booking.unitId);
      }
    }

    const unitBlockReasons = new Map<string, string>();
    for (const block of overlappingBlocks) {
      if (
        block.unitId !== null &&
        intervalsOverlap(startAt, endAt, block.startAt, block.endAt)
      ) {
        busyIds.add(block.unitId);
        unitBlockReasons.set(block.unitId, block.reason);
      }
    }

    const freeIds = candidateUnitIds.filter((id) => !busyIds.has(id));
    if (freeIds.length === 0) {
      if (isSpecificUnit && unitBlockReasons.has(candidateUnitIds[0])) {
        throw new ConflictException(
          `Unit sedang diblokir: ${unitBlockReasons.get(candidateUnitIds[0])}`,
        );
      }
      throw new ConflictException(
        isSpecificUnit
          ? 'Slot pada unit yang dipilih sudah terisi pada rentang waktu tersebut'
          : 'Semua unit pada tipe yang dipilih sudah terisi pada rentang waktu tersebut',
      );
    }

    return freeIds;
  }

  private async assertNoScheduleBlockConflict(
    tx: Prisma.TransactionClient,
    tenantId: string,
    unitId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<void> {
    const block = await tx.scheduleBlock.findFirst({
      where: {
        tenantId,
        OR: [{ unitId: null }, { unitId }],
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { unitId: true, reason: true },
    });

    if (block) {
      throw new ConflictException(
        block.unitId === null
          ? `Seluruh tempat sedang diblokir: ${block.reason}`
          : `Unit sedang diblokir: ${block.reason}`,
      );
    }
  }
}
