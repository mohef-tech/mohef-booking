import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ClockService } from '../common/clock.service.js';
import {
  ActorRole,
  BookingSource,
  BookingStatus,
  PaymentTransactionStatus,
  PaymentType,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeEventsService } from '../realtime/realtime-events.service.js';

const MIN_REOPEN_SLOT_MINUTES = 30;
const SWEEP_INTERVAL_MS = 15_000;

export interface SweepSummary {
  sweptAt: string;
  expiredHoldCount: number;
  noShowCount: number;
  reopenedSlotCount: number;
  blockedShortRemainderCount: number;
}

@Injectable()
export class BookingAutomationService {
  private readonly logger = new Logger(BookingAutomationService.name);
  private isSweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async handleIntervalSweep(): Promise<void> {
    if (this.isSweeping) {
      return;
    }

    this.isSweeping = true;
    try {
      const summary = await this.runSweep(this.clock.now());
      if (summary.expiredHoldCount > 0 || summary.noShowCount > 0) {
        this.logger.log(
          `Sweep selesai: ${summary.expiredHoldCount} hold DP kedaluwarsa, ${summary.noShowCount} booking no-show`,
        );
      }
    } catch (error) {
      this.logger.error('Gagal menjalankan sweep otomatis', error);
    } finally {
      this.isSweeping = false;
    }
  }

  async runSweep(
    referenceNow: Date = this.clock.now(),
    tenantId?: string,
  ): Promise<SweepSummary> {
    const expiredHoldCount = await this.sweepExpiredDpHolds(
      referenceNow,
      tenantId,
    );
    const noShowResult = await this.sweepNoShows(referenceNow, tenantId);

    return {
      sweptAt: referenceNow.toISOString(),
      expiredHoldCount,
      noShowCount: noShowResult.noShowCount,
      reopenedSlotCount: noShowResult.reopenedSlotCount,
      blockedShortRemainderCount: noShowResult.blockedShortRemainderCount,
    };
  }

  private async sweepExpiredDpHolds(
    now: Date,
    tenantId?: string,
  ): Promise<number> {
    const expiredCandidates = await this.prisma.booking.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: BookingStatus.HOLD_DP,
        payments: {
          some: {
            type: PaymentType.DP,
            status: PaymentTransactionStatus.PENDING,
            expiresAt: { lte: now },
          },
        },
      },
      include: {
        unit: { select: { code: true } },
        payments: {
          where: {
            type: PaymentType.DP,
            status: PaymentTransactionStatus.PENDING,
            expiresAt: { lte: now },
          },
          select: { id: true },
        },
      },
    });

    let processed = 0;

    for (const candidate of expiredCandidates) {
      const paymentIds = candidate.payments.map((p) => p.id);
      if (paymentIds.length === 0) {
        continue;
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.booking.updateMany({
          where: {
            id: candidate.id,
            status: BookingStatus.HOLD_DP,
          },
          data: {
            status: BookingStatus.CANCELLED,
          },
        });

        if (claim.count === 0) {
          return false;
        }

        await tx.payment.updateMany({
          where: {
            id: { in: paymentIds },
            status: PaymentTransactionStatus.PENDING,
          },
          data: {
            status: PaymentTransactionStatus.EXPIRED,
          },
        });

        await tx.bookingLog.create({
          data: {
            tenantId: candidate.tenantId,
            bookingId: candidate.id,
            action: 'DP_HOLD_EXPIRED_CANCELLED',
            actorRole: ActorRole.SYSTEM,
            notes:
              'Batas waktu penahanan DP habis; pembayaran kedaluwarsa dan slot kalender dilepas otomatis',
          },
        });

        return true;
      });

      if (updated) {
        processed += 1;
        this.realtimeEvents.emit({
          event: 'DP_EXPIRED',
          tenantId: candidate.tenantId,
          bookingId: candidate.id,
          bookingCode: candidate.bookingCode,
          unitId: candidate.unitId,
          unitCode: candidate.unit.code,
          status: BookingStatus.CANCELLED,
          paymentStatus: candidate.paymentStatus,
          startAt: candidate.startAt.toISOString(),
          endAt: candidate.endAt.toISOString(),
          effectiveCheckinDeadline:
            candidate.effectiveCheckinDeadline.toISOString(),
          occurredAt: now.toISOString(),
          summary: 'Penahanan DP kedaluwarsa, slot dilepas otomatis',
        });
      }
    }

    return processed;
  }

  private async sweepNoShows(
    now: Date,
    tenantId?: string,
  ): Promise<{
    noShowCount: number;
    reopenedSlotCount: number;
    blockedShortRemainderCount: number;
  }> {
    const overdueBookings = await this.prisma.booking.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: BookingStatus.CONFIRMED,
        effectiveCheckinDeadline: { lt: now },
        source: { not: BookingSource.WALK_IN },
        logs: {
          none: {
            action: 'BOOKING_CHECKED_IN',
          },
        },
      },
      include: {
        unit: { select: { code: true } },
      },
    });

    let noShowCount = 0;
    let reopenedSlotCount = 0;
    let blockedShortRemainderCount = 0;

    for (const candidate of overdueBookings) {
      const remainingMinutes = Math.max(
        0,
        Math.floor(
          (candidate.endAt.getTime() -
            candidate.effectiveCheckinDeadline.getTime()) /
            60_000,
        ),
      );
      const isReopened = remainingMinutes >= MIN_REOPEN_SLOT_MINUTES;

      const updated = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.booking.updateMany({
          where: {
            id: candidate.id,
            status: BookingStatus.CONFIRMED,
          },
          data: {
            status: BookingStatus.NO_SHOW,
          },
        });

        if (claim.count === 0) {
          return false;
        }

        if (
          !isReopened &&
          candidate.endAt.getTime() > candidate.effectiveCheckinDeadline.getTime()
        ) {
          await tx.scheduleBlock.create({
            data: {
              tenantId: candidate.tenantId,
              unitId: candidate.unitId,
              startAt: candidate.effectiveCheckinDeadline,
              endAt: candidate.endAt,
              reason: `Sisa slot no-show ${candidate.bookingCode} (${remainingMinutes} menit < 30 menit) tidak dijual kembali`,
            },
          });
        }

        await tx.bookingLog.create({
          data: {
            tenantId: candidate.tenantId,
            bookingId: candidate.id,
            action: isReopened
              ? 'NO_SHOW_SLOT_REOPENED'
              : 'NO_SHOW_REMAINDER_TOO_SHORT',
            actorRole: ActorRole.SYSTEM,
            notes: isReopened
              ? `Pelanggan tidak hadir melewati tenggang check-in; DP ditahan, sisa slot ${remainingMinutes} menit (>= 30 menit) dibuka kembali`
              : `Pelanggan tidak hadir melewati tenggang check-in; DP ditahan, sisa slot ${remainingMinutes} menit (< 30 menit) terlalu pendek dan tidak dijual kembali`,
          },
        });

        return true;
      });

      if (updated) {
        noShowCount += 1;
        if (isReopened) {
          reopenedSlotCount += 1;
        } else {
          blockedShortRemainderCount += 1;
        }

        this.realtimeEvents.emit({
          event: 'SLOT_RELEASED_NO_SHOW',
          tenantId: candidate.tenantId,
          bookingId: candidate.id,
          bookingCode: candidate.bookingCode,
          unitId: candidate.unitId,
          unitCode: candidate.unit.code,
          status: BookingStatus.NO_SHOW,
          paymentStatus: candidate.paymentStatus,
          startAt: candidate.startAt.toISOString(),
          endAt: candidate.endAt.toISOString(),
          effectiveCheckinDeadline:
            candidate.effectiveCheckinDeadline.toISOString(),
          occurredAt: now.toISOString(),
          summary: isReopened
            ? `No-show: sisa ${remainingMinutes} menit dibuka kembali`
            : `No-show: sisa ${remainingMinutes} menit (< 30 menit) tidak dijual kembali`,
        });
      }
    }

    return {
      noShowCount,
      reopenedSlotCount,
      blockedShortRemainderCount,
    };
  }
}
