import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClockService } from '../common/clock.service.js';
import { isExclusionConstraintError } from '../common/prisma-error.util.js';
import {
  ACTIVE_BOOKING_STATUSES,
  buildJakartaBookingInterval,
  calculateSlotPricing,
  detectJakartaDayCategory,
  getCurrentJakartaSlot,
  getJakartaClosingDateTime,
  getJakartaDateString,
  SLOT_INTERVAL_MINUTES,
} from '../common/time-slot.util.js';
import {
  ActorRole,
  BookingPaymentStatus,
  BookingStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentTransactionStatus,
  PaymentType,
  type Prisma,
  type Tenant,
  type Unit,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeEventsService } from '../realtime/realtime-events.service.js';
import type { RealtimeEventType } from '../realtime/realtime.types.js';
import {
  attachRemainingAmount,
  BOOKING_DETAIL_INCLUDE,
  buildRealtimeBookingEvent,
  type BookingDetailResponse,
  type BookingWithDetails,
} from './booking.constants.js';
import type { AdminCancelDto } from './dto/admin-cancel.dto.js';
import type { CheckInBookingDto } from './dto/check-in-booking.dto.js';
import type { ExtendDurationDto } from './dto/extend-duration.dto.js';
import type { ExtendGraceDto } from './dto/extend-grace.dto.js';
import type { MoveUnitDto } from './dto/move-unit.dto.js';
import type { RescheduleBookingDto } from './dto/reschedule-booking.dto.js';
import type { ResolveConflictDto } from './dto/resolve-conflict.dto.js';

const MIN_EFFECTIVE_PLAY_MINUTES = 15;
const RESCHEDULE_CUTOFF_MINUTES = 60;

@Injectable()
export class BookingOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  private emitBookingEvent(
    event: RealtimeEventType,
    booking: BookingWithDetails,
    occurredAt: Date,
    summary?: string,
  ): BookingDetailResponse {
    this.realtimeEvents.emit(
      buildRealtimeBookingEvent(event, booking, occurredAt, summary),
    );
    return attachRemainingAmount(booking);
  }

  async checkIn(
    tenant: Tenant,
    bookingId: string,
    dto: CheckInBookingDto,
  ): Promise<BookingDetailResponse> {
    const now = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new ConflictException(
          `Check-in hanya dapat dilakukan untuk booking berstatus CONFIRMED (status saat ini: ${booking.status})`,
        );
      }

      if (now.getTime() > booking.effectiveCheckinDeadline.getTime()) {
        throw new ConflictException(
          'Batas waktu check-in (tenggang kedatangan) sudah terlewati',
        );
      }

      if (booking.paymentStatus === BookingPaymentStatus.UNPAID) {
        throw new ConflictException(
          'Pembayaran DP belum terverifikasi sehingga tidak dapat check-in',
        );
      }

      if (booking.paymentStatus === BookingPaymentStatus.DP_PAID) {
        if (!dto.paymentMethod) {
          throw new BadRequestException(
            'Metode pelunasan (CASH atau QRIS) wajib diisi untuk sisa pembayaran 50%',
          );
        }

        const settlementAmount = Math.max(
          0,
          booking.totalAmount - booking.paidAmount,
        );
        const provider =
          dto.paymentMethod === PaymentMethod.CASH
            ? PaymentProvider.CASH
            : PaymentProvider.SIMULATOR;

        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            paidAmount: booking.totalAmount,
            paymentStatus: BookingPaymentStatus.PAID,
            payments: {
              create: {
                tenantId: tenant.id,
                provider,
                method: dto.paymentMethod,
                type: PaymentType.SETTLEMENT,
                amount: settlementAmount,
                status: PaymentTransactionStatus.VERIFIED,
                verifiedAt: now,
              },
            },
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'BOOKING_CHECKED_IN',
                actorRole: ActorRole.CASHIER,
                notes: `Pelanggan check-in & pelunasan sisa Rp ${settlementAmount} (${dto.paymentMethod})`,
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        return this.emitBookingEvent(
          'CHECKED_IN',
          updated,
          now,
          `Check-in & pelunasan Rp ${settlementAmount} (${dto.paymentMethod})`,
        );
      }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          logs: {
            create: {
              tenantId: tenant.id,
              action: 'BOOKING_CHECKED_IN',
              actorRole: ActorRole.CASHIER,
              notes: 'Pelanggan check-in (pembayaran sudah lunas)',
            },
          },
        },
        include: BOOKING_DETAIL_INCLUDE,
      });

      return this.emitBookingEvent(
        'CHECKED_IN',
        updated,
        now,
        'Pelanggan check-in (sudah lunas)',
      );
    });
  }

  async startPlay(
    tenant: Tenant,
    bookingId: string,
  ): Promise<BookingDetailResponse> {
    const now = this.clock.now();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

        if (booking.status !== BookingStatus.CONFIRMED) {
          throw new ConflictException(
            `Sesi main hanya dapat dimulai dari status CONFIRMED (status saat ini: ${booking.status})`,
          );
        }

        if (booking.paymentStatus !== BookingPaymentStatus.PAID) {
          throw new ConflictException(
            'Pelanggan harus check-in dan melunasi pembayaran sebelum mulai bermain',
          );
        }

        const initialDurationMs =
          booking.endAt.getTime() - booking.startAt.getTime();
        const candidateEndAt = new Date(now.getTime() + initialDurationMs);
        const closingAt = getJakartaClosingDateTime(
          booking.startAt,
          tenant.closeTime,
        );

        if (now.getTime() >= closingAt.getTime()) {
          throw new BadRequestException(
            'Jam operasional tenant sudah berakhir',
          );
        }

        const hasFollowingOverlap =
          candidateEndAt.getTime() > booking.endAt.getTime()
            ? await this.hasUnitTimeConflict(
                tx,
                tenant.id,
                booking.unitId,
                booking.endAt,
                candidateEndAt,
                booking.id,
              )
            : false;

        let nextEndAt = booking.endAt;
        if (!hasFollowingOverlap) {
          const cappedEndMs = Math.min(
            candidateEndAt.getTime(),
            closingAt.getTime(),
          );
          if (cappedEndMs > booking.startAt.getTime() && cappedEndMs > now.getTime()) {
            nextEndAt = new Date(cappedEndMs);
          }
        }

        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.PLAYING,
            actualPlayStartAt: now,
            endAt: nextEndAt,
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'PLAY_STARTED',
                actorRole: ActorRole.CASHIER,
                notes: hasFollowingOverlap
                  ? 'Mulai main (pegang stik); ada booking berikutnya sehingga jam selesai kalender dipertahankan'
                  : 'Mulai main (pegang stik); jam selesai dihitung penuh dari waktu mulai aktual',
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        return this.emitBookingEvent(
          'PLAY_STARTED',
          updated,
          now,
          'Mulai main (pegang stik)',
        );
      });
    } catch (error) {
      if (isExclusionConstraintError(error)) {
        throw new ConflictException(
          'Tidak dapat menggeser jam selesai karena bentrok dengan jadwal lain pada unit ini',
        );
      }
      throw error;
    }
  }

  async complete(
    tenant: Tenant,
    bookingId: string,
  ): Promise<BookingDetailResponse> {
    return this.prisma.$transaction(async (tx) => {
      const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

      if (booking.status !== BookingStatus.PLAYING) {
        throw new ConflictException(
          `Hanya sesi berstatus PLAYING yang dapat diselesaikan (status saat ini: ${booking.status})`,
        );
      }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.COMPLETED,
          logs: {
            create: {
              tenantId: tenant.id,
              action: 'BOOKING_COMPLETED',
              actorRole: ActorRole.CASHIER,
              notes: 'Sesi bermain selesai',
            },
          },
        },
        include: BOOKING_DETAIL_INCLUDE,
      });

      return this.emitBookingEvent(
        'BOOKING_UPDATED',
        updated,
        this.clock.now(),
        'Sesi bermain selesai (COMPLETED)',
      );
    });
  }

  async extendGrace(
    tenant: Tenant,
    bookingId: string,
    dto: ExtendGraceDto,
  ): Promise<BookingDetailResponse> {
    if (dto.extraMinutes > tenant.maxGraceExtensionMinutes) {
      throw new BadRequestException(
        `Tambahan tenggang maksimal adalah ${tenant.maxGraceExtensionMinutes} menit`,
      );
    }

    const now = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new ConflictException(
          `Perpanjangan tenggang hanya untuk booking CONFIRMED (status saat ini: ${booking.status})`,
        );
      }

      if (booking.graceExtendedCount > 0) {
        throw new ConflictException(
          'Perpanjangan tenggang hanya diperbolehkan maksimal 1 kali per booking',
        );
      }

      if (now.getTime() > booking.effectiveCheckinDeadline.getTime()) {
        throw new ConflictException(
          'Tenggang check-in awal sudah berakhir, tidak dapat diperpanjang',
        );
      }

      const newDeadline = new Date(
        booking.effectiveCheckinDeadline.getTime() +
          dto.extraMinutes * 60_000,
      );
      const remainingEffectiveMs =
        booking.endAt.getTime() - newDeadline.getTime();

      if (remainingEffectiveMs < MIN_EFFECTIVE_PLAY_MINUTES * 60_000) {
        throw new BadRequestException(
          `Sisa waktu bermain efektif setelah perpanjangan tenggang wajib minimal ${MIN_EFFECTIVE_PLAY_MINUTES} menit`,
        );
      }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          effectiveCheckinDeadline: newDeadline,
          graceExtendedCount: booking.graceExtendedCount + 1,
          logs: {
            create: {
              tenantId: tenant.id,
              action: 'GRACE_EXTENDED',
              actorRole: ActorRole.CASHIER,
              notes: `Tenggang check-in diperpanjang +${dto.extraMinutes} menit`,
            },
          },
        },
        include: BOOKING_DETAIL_INCLUDE,
      });

      return this.emitBookingEvent(
        'GRACE_EXTENDED',
        updated,
        now,
        `Tenggang check-in diperpanjang +${dto.extraMinutes} menit`,
      );
    });
  }

  async reschedule(
    tenant: Tenant,
    bookingId: string,
    dto: RescheduleBookingDto,
  ): Promise<BookingDetailResponse> {
    const now = this.clock.now();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

        if (booking.status !== BookingStatus.CONFIRMED) {
          throw new ConflictException(
            `Reschedule hanya untuk booking CONFIRMED (status saat ini: ${booking.status})`,
          );
        }

        if (booking.rescheduleCount > 0) {
          throw new ConflictException(
            'Reschedule hanya diperbolehkan maksimal 1 kali per booking',
          );
        }

        const cutoffAt =
          booking.startAt.getTime() - RESCHEDULE_CUTOFF_MINUTES * 60_000;
        if (now.getTime() > cutoffAt) {
          throw new ConflictException(
            'Reschedule hanya dapat dilakukan paling lambat 1 jam sebelum jam mulai',
          );
        }

        const durationMinutes = Math.round(
          (booking.endAt.getTime() - booking.startAt.getTime()) / 60_000,
        );
        const interval = buildJakartaBookingInterval({
          date: dto.date,
          startTime: dto.startTime,
          durationMinutes,
          openTime: tenant.openTime,
          closeTime: tenant.closeTime,
          gracePeriodMinutes: tenant.gracePeriodMinutes,
        });

        const currentSlot = getCurrentJakartaSlot(now);
        if (interval.startAt.getTime() < currentSlot.startAt.getTime()) {
          throw new BadRequestException(
            'Tidak dapat menjadwal ulang ke waktu yang sudah berlalu',
          );
        }

        const targetUnit = await this.resolveTargetUnit(
          tx,
          tenant.id,
          dto.unitId ?? booking.unitId,
          booking.unit.type,
        );

        const hasConflict = await this.hasUnitTimeConflict(
          tx,
          tenant.id,
          targetUnit.id,
          interval.startAt,
          interval.endAt,
          booking.id,
        );
        if (hasConflict) {
          throw new ConflictException(
            'Unit dan jadwal baru tidak tersedia pada rentang waktu tersebut',
          );
        }

        const dayCategory = detectJakartaDayCategory(dto.date);
        const rateRule = await tx.rateRule.findUnique({
          where: {
            tenantId_unitType_dayCategory: {
              tenantId: tenant.id,
              unitType: targetUnit.type,
              dayCategory,
            },
          },
        });
        if (!rateRule) {
          throw new NotFoundException(
            `Tarif untuk ${targetUnit.type} (${dayCategory}) belum dikonfigurasi`,
          );
        }

        const pricing = calculateSlotPricing(
          rateRule.hourlyRate,
          durationMinutes,
          dayCategory,
        );

        const nextPaymentStatus =
          booking.paidAmount >= pricing.totalAmount
            ? BookingPaymentStatus.PAID
            : booking.paidAmount > 0
              ? BookingPaymentStatus.DP_PAID
              : BookingPaymentStatus.UNPAID;

        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            unitId: targetUnit.id,
            startAt: interval.startAt,
            endAt: interval.endAt,
            effectiveCheckinDeadline: interval.effectiveCheckinDeadline,
            rescheduleCount: booking.rescheduleCount + 1,
            totalAmount: pricing.totalAmount,
            dpAmount: pricing.dpAmount,
            paymentStatus: nextPaymentStatus,
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'BOOKING_RESCHEDULED',
                actorRole: ActorRole.CUSTOMER,
                notes: `Reschedule ke ${targetUnit.code} pada ${dto.date} ${dto.startTime} WIB (total baru Rp ${pricing.totalAmount})`,
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        return this.emitBookingEvent(
          'BOOKING_UPDATED',
          updated,
          now,
          `Reschedule ke ${targetUnit.code} (${dto.date} ${dto.startTime} WIB)`,
        );
      });
    } catch (error) {
      if (isExclusionConstraintError(error)) {
        throw new ConflictException(
          'Slot tujuan sudah terisi pada rentang waktu tersebut',
        );
      }
      throw error;
    }
  }

  async extendDuration(
    tenant: Tenant,
    bookingId: string,
    dto: ExtendDurationDto,
  ): Promise<BookingDetailResponse> {
    if (dto.extraMinutes % SLOT_INTERVAL_MINUTES !== 0) {
      throw new BadRequestException(
        'Tambahan durasi harus kelipatan 30 menit',
      );
    }

    const now = this.clock.now();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

        if (
          booking.status !== BookingStatus.CONFIRMED &&
          booking.status !== BookingStatus.PLAYING
        ) {
          throw new ConflictException(
            `Tambah durasi hanya untuk booking CONFIRMED atau PLAYING (status saat ini: ${booking.status})`,
          );
        }

        const newEndAt = new Date(
          booking.endAt.getTime() + dto.extraMinutes * 60_000,
        );
        const closingAt = getJakartaClosingDateTime(
          booking.startAt,
          tenant.closeTime,
        );

        if (newEndAt.getTime() > closingAt.getTime()) {
          throw new BadRequestException(
            `Perpanjangan durasi melebihi jam tutup operasional (${tenant.closeTime} WIB)`,
          );
        }

        const hasConflict = await this.hasUnitTimeConflict(
          tx,
          tenant.id,
          booking.unitId,
          booking.endAt,
          newEndAt,
          booking.id,
        );
        if (hasConflict) {
          throw new ConflictException(
            'Slot setelah sesi ini sudah terisi atau diblokir',
          );
        }

        const dayCategory = detectJakartaDayCategory(
          getJakartaDateString(booking.endAt),
        );
        const rateRule = await tx.rateRule.findUnique({
          where: {
            tenantId_unitType_dayCategory: {
              tenantId: tenant.id,
              unitType: booking.unit.type,
              dayCategory,
            },
          },
        });
        if (!rateRule) {
          throw new NotFoundException(
            `Tarif untuk ${booking.unit.type} (${dayCategory}) belum dikonfigurasi`,
          );
        }

        const additionalCost = Math.round(
          (rateRule.hourlyRate * dto.extraMinutes) / 60,
        );
        const nextTotalAmount = booking.totalAmount + additionalCost;
        const nextPaidAmount = booking.paidAmount + additionalCost;
        const nextPaymentStatus =
          nextPaidAmount >= nextTotalAmount
            ? BookingPaymentStatus.PAID
            : booking.paymentStatus;

        const provider =
          dto.paymentMethod === PaymentMethod.CASH
            ? PaymentProvider.CASH
            : PaymentProvider.SIMULATOR;

        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            endAt: newEndAt,
            totalAmount: nextTotalAmount,
            paidAmount: nextPaidAmount,
            paymentStatus: nextPaymentStatus,
            payments: {
              create: {
                tenantId: tenant.id,
                provider,
                method: dto.paymentMethod,
                type: PaymentType.DIRECT_FULL,
                amount: additionalCost,
                status: PaymentTransactionStatus.VERIFIED,
                verifiedAt: now,
              },
            },
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'DURATION_EXTENDED',
                actorRole: ActorRole.CASHIER,
                notes: `Durasi ditambah +${dto.extraMinutes} menit (Rp ${additionalCost} via ${dto.paymentMethod})`,
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        return this.emitBookingEvent(
          'BOOKING_UPDATED',
          updated,
          now,
          `Durasi ditambah +${dto.extraMinutes} menit`,
        );
      });
    } catch (error) {
      if (isExclusionConstraintError(error)) {
        throw new ConflictException(
          'Slot perpanjangan sudah terisi pada unit ini',
        );
      }
      throw error;
    }
  }

  async moveUnit(
    tenant: Tenant,
    bookingId: string,
    dto: MoveUnitDto,
  ): Promise<BookingDetailResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

        if (
          booking.status !== BookingStatus.CONFIRMED &&
          booking.status !== BookingStatus.PLAYING
        ) {
          throw new ConflictException(
            `Pindah unit hanya untuk booking CONFIRMED atau PLAYING (status saat ini: ${booking.status})`,
          );
        }

        if (dto.targetUnitId === booking.unitId) {
          throw new BadRequestException(
            'Unit tujuan sama dengan unit saat ini',
          );
        }

        const targetUnit = await this.resolveTargetUnit(
          tx,
          tenant.id,
          dto.targetUnitId,
          booking.unit.type,
        );

        const hasConflict = await this.hasUnitTimeConflict(
          tx,
          tenant.id,
          targetUnit.id,
          booking.startAt,
          booking.endAt,
          booking.id,
        );
        if (hasConflict) {
          throw new ConflictException(
            `Unit tujuan ${targetUnit.code} tidak tersedia pada rentang waktu booking`,
          );
        }

        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            unitId: targetUnit.id,
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'UNIT_MOVED',
                actorRole: ActorRole.CASHIER,
                notes: `Dipindahkan dari ${booking.unit.code} ke ${targetUnit.code}`,
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        return this.emitBookingEvent(
          'BOOKING_UPDATED',
          updated,
          this.clock.now(),
          `Dipindahkan dari ${booking.unit.code} ke ${targetUnit.code}`,
        );
      });
    } catch (error) {
      if (isExclusionConstraintError(error)) {
        throw new ConflictException(
          'Unit tujuan sudah terisi pada rentang waktu tersebut',
        );
      }
      throw error;
    }
  }

  async resolveConflict(
    tenant: Tenant,
    bookingId: string,
    dto: ResolveConflictDto,
  ): Promise<BookingDetailResponse> {
    const now = this.clock.now();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

        if (booking.status !== BookingStatus.CONFLICT_ADMIN) {
          throw new ConflictException(
            `Hanya booking berstatus CONFLICT_ADMIN yang dapat diresolusi (status saat ini: ${booking.status})`,
          );
        }

        if (dto.action === 'REFUND') {
          const updated = await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: BookingStatus.CANCELLED,
              ...(booking.paidAmount > 0
                ? {
                    payments: {
                      create: {
                        tenantId: tenant.id,
                        provider: PaymentProvider.CASH,
                        method: PaymentMethod.CASH,
                        type: PaymentType.REFUND,
                        amount: booking.paidAmount,
                        status: PaymentTransactionStatus.REFUNDED,
                        verifiedAt: now,
                      },
                    },
                  }
                : {}),
              logs: {
                create: {
                  tenantId: tenant.id,
                  action: 'CONFLICT_RESOLVED_REFUND',
                  actorRole: ActorRole.ADMIN,
                  notes:
                    dto.notes?.trim() ||
                    `Konflik diselesaikan dengan refund Rp ${booking.paidAmount}`,
                },
              },
            },
            include: BOOKING_DETAIL_INCLUDE,
          });

          return this.emitBookingEvent(
            'BOOKING_UPDATED',
            updated,
            now,
            `Konflik diselesaikan (REFUND Rp ${booking.paidAmount})`,
          );
        }

        if (!dto.unitId || !dto.date || !dto.startTime) {
          throw new BadRequestException(
            'Aksi REASSIGN wajib menyertakan unitId, date, dan startTime',
          );
        }

        const durationMinutes = Math.round(
          (booking.endAt.getTime() - booking.startAt.getTime()) / 60_000,
        );
        const interval = buildJakartaBookingInterval({
          date: dto.date,
          startTime: dto.startTime,
          durationMinutes,
          openTime: tenant.openTime,
          closeTime: tenant.closeTime,
          gracePeriodMinutes: tenant.gracePeriodMinutes,
        });

        const currentSlot = getCurrentJakartaSlot(now);
        if (interval.startAt.getTime() < currentSlot.startAt.getTime()) {
          throw new BadRequestException(
            'Tidak dapat mengalihkan konflik ke jadwal yang sudah berlalu',
          );
        }

        const targetUnit = await this.resolveTargetUnit(
          tx,
          tenant.id,
          dto.unitId,
        );

        const hasConflict = await this.hasUnitTimeConflict(
          tx,
          tenant.id,
          targetUnit.id,
          interval.startAt,
          interval.endAt,
          booking.id,
        );
        if (hasConflict) {
          throw new ConflictException(
            `Unit ${targetUnit.code} tidak tersedia pada jadwal pengganti tersebut`,
          );
        }

        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            unitId: targetUnit.id,
            startAt: interval.startAt,
            endAt: interval.endAt,
            effectiveCheckinDeadline: interval.effectiveCheckinDeadline,
            status: BookingStatus.CONFIRMED,
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'CONFLICT_RESOLVED_REASSIGN',
                actorRole: ActorRole.ADMIN,
                notes:
                  dto.notes?.trim() ||
                  `Konflik dialihkan ke ${targetUnit.code} pada ${dto.date} ${dto.startTime} WIB`,
              },
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });

        return this.emitBookingEvent(
          'BOOKING_UPDATED',
          updated,
          now,
          `Konflik dialihkan ke ${targetUnit.code} (${dto.date} ${dto.startTime} WIB)`,
        );
      });
    } catch (error) {
      if (isExclusionConstraintError(error)) {
        throw new ConflictException(
          'Jadwal pengganti sudah terisi pada unit yang dipilih',
        );
      }
      throw error;
    }
  }

  async adminCancel(
    tenant: Tenant,
    bookingId: string,
    dto: AdminCancelDto,
  ): Promise<BookingDetailResponse> {
    const now = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const booking = await this.findBookingOrThrow(tx, tenant.id, bookingId);

      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new ConflictException(
          `Pembatalan pengelola hanya untuk booking CONFIRMED (status saat ini: ${booking.status})`,
        );
      }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CANCELLED,
          ...(booking.paidAmount > 0
            ? {
                payments: {
                  create: {
                    tenantId: tenant.id,
                    provider: PaymentProvider.CASH,
                    method: PaymentMethod.CASH,
                    type: PaymentType.REFUND,
                    amount: booking.paidAmount,
                    status: PaymentTransactionStatus.REFUNDED,
                    verifiedAt: now,
                  },
                },
              }
            : {}),
          logs: {
            create: {
              tenantId: tenant.id,
              action: 'BOOKING_ADMIN_CANCELLED',
              actorRole: ActorRole.ADMIN,
              notes:
                dto.reason?.trim() ||
                `Dibatalkan oleh pengelola dengan refund Rp ${booking.paidAmount}`,
            },
          },
        },
        include: BOOKING_DETAIL_INCLUDE,
      });

      return this.emitBookingEvent(
        'BOOKING_UPDATED',
        updated,
        now,
        `Dibatalkan oleh pengelola (refund Rp ${booking.paidAmount})`,
      );
    });
  }

  private async findBookingOrThrow(
    tx: Prisma.TransactionClient,
    tenantId: string,
    bookingId: string,
  ): Promise<BookingWithDetails> {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, tenantId },
      include: BOOKING_DETAIL_INCLUDE,
    });

    if (!booking) {
      throw new NotFoundException('Booking tidak ditemukan');
    }

    return booking;
  }

  private async resolveTargetUnit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    unitId: string,
    expectedType?: Unit['type'],
  ): Promise<Unit> {
    const unit = await tx.unit.findFirst({
      where: { id: unitId, tenantId },
    });

    if (!unit) {
      throw new NotFoundException('Unit tujuan tidak ditemukan');
    }
    if (!unit.isActive) {
      throw new BadRequestException(`Unit "${unit.code}" sedang nonaktif`);
    }
    if (expectedType && unit.type !== expectedType) {
      throw new BadRequestException(
        `Unit tujuan harus bertipe sama (${expectedType}), bukan ${unit.type}`,
      );
    }

    return unit;
  }

  private async hasUnitTimeConflict(
    tx: Prisma.TransactionClient,
    tenantId: string,
    unitId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId: string,
  ): Promise<boolean> {
    const [conflictingBooking, conflictingBlock] = await Promise.all([
      tx.booking.findFirst({
        where: {
          tenantId,
          id: { not: excludeBookingId },
          unitId,
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      }),
      tx.scheduleBlock.findFirst({
        where: {
          tenantId,
          OR: [{ unitId: null }, { unitId }],
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      }),
    ]);

    return conflictingBooking !== null || conflictingBlock !== null;
  }
}
