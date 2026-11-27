import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClockService } from '../common/clock.service.js';
import { isExclusionConstraintError } from '../common/prisma-error.util.js';
import { ACTIVE_BOOKING_STATUSES } from '../common/time-slot.util.js';
import {
  ActorRole,
  BookingPaymentStatus,
  BookingStatus,
  PaymentTransactionStatus,
  PaymentType,
  type Prisma,
  type Tenant,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeEventsService } from '../realtime/realtime-events.service.js';
import type { SimulatePaymentDto } from './dto/simulate-payment.dto.js';

const PAYMENT_WITH_BOOKING_INCLUDE = {
  booking: {
    include: {
      unit: {
        select: { id: true, code: true, name: true, type: true },
      },
    },
  },
} satisfies Prisma.PaymentInclude;

const BOOKING_RESULT_INCLUDE = {
  unit: {
    select: { id: true, code: true, name: true, type: true },
  },
  payments: {
    orderBy: { createdAt: 'asc' as const },
  },
  logs: {
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.BookingInclude;

type PaymentWithBooking = Prisma.PaymentGetPayload<{
  include: typeof PAYMENT_WITH_BOOKING_INCLUDE;
}>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  async simulateVerify(tenant: Tenant, dto: SimulatePaymentDto) {
    const paymentWithBooking = await this.resolveTargetPayment(tenant.id, dto);
    const { booking } = paymentWithBooking;

    if (paymentWithBooking.status === PaymentTransactionStatus.VERIFIED) {
      throw new ConflictException('Pembayaran sudah terverifikasi sebelumnya');
    }

    if (paymentWithBooking.status === PaymentTransactionStatus.REFUNDED) {
      throw new ConflictException('Pembayaran sudah dikembalikan (REFUNDED)');
    }

    const now = this.clock.now();
    const isHoldExpired =
      paymentWithBooking.status === PaymentTransactionStatus.EXPIRED ||
      booking.status === BookingStatus.EXPIRED ||
      (paymentWithBooking.expiresAt !== null &&
        now.getTime() > paymentWithBooking.expiresAt.getTime());

    const isNonConfirmableStatus =
      booking.status !== BookingStatus.HOLD_DP &&
      booking.status !== BookingStatus.EXPIRED;

    const nextPaidAmount = booking.paidAmount + paymentWithBooking.amount;
    const nextPaymentStatus =
      nextPaidAmount >= booking.totalAmount
        ? BookingPaymentStatus.PAID
        : BookingPaymentStatus.DP_PAID;

    if (isNonConfirmableStatus) {
      return this.markConflictAdmin(
        tenant.id,
        paymentWithBooking,
        now,
        nextPaidAmount,
        nextPaymentStatus,
        `Pembayaran terverifikasi namun status booking sudah ${booking.status}; dialihkan ke antrean konflik admin`,
      );
    }

    if (isHoldExpired) {
      const hasConflict = await this.hasActiveSlotConflict(
        tenant.id,
        booking.id,
        booking.unitId,
        booking.startAt,
        booking.endAt,
      );

      if (hasConflict) {
        return this.markConflictAdmin(
          tenant.id,
          paymentWithBooking,
          now,
          nextPaidAmount,
          nextPaymentStatus,
          'Pembayaran DP masuk setelah masa hold kedaluwarsa dan slot sudah diisi jadwal lain; masuk antrean konflik admin',
        );
      }
    }

    try {
      const updatedBooking = await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: paymentWithBooking.id },
          data: {
            status: PaymentTransactionStatus.VERIFIED,
            verifiedAt: now,
          },
        });

        return tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CONFIRMED,
            paidAmount: nextPaidAmount,
            paymentStatus: nextPaymentStatus,
            logs: {
              create: {
                tenantId: tenant.id,
                action: 'DP_PAYMENT_VERIFIED',
                actorRole: ActorRole.SYSTEM,
                notes: isHoldExpired
                  ? 'Pembayaran DP terlambat terverifikasi via simulator; slot masih kosong sehingga booking dikonfirmasi'
                  : 'Pembayaran DP terverifikasi via simulator; status booking menjadi CONFIRMED',
              },
            },
          },
          include: BOOKING_RESULT_INCLUDE,
        });
      });

      this.realtimeEvents.emit({
        event: 'DP_VERIFIED',
        tenantId: updatedBooking.tenantId,
        bookingId: updatedBooking.id,
        bookingCode: updatedBooking.bookingCode,
        unitId: updatedBooking.unitId,
        unitCode: updatedBooking.unit.code,
        status: updatedBooking.status,
        paymentStatus: updatedBooking.paymentStatus,
        startAt: updatedBooking.startAt.toISOString(),
        endAt: updatedBooking.endAt.toISOString(),
        effectiveCheckinDeadline:
          updatedBooking.effectiveCheckinDeadline.toISOString(),
        occurredAt: now.toISOString(),
        summary: 'DP terverifikasi; status booking CONFIRMED',
      });

      return {
        outcome: 'CONFIRMED' as const,
        booking: {
          ...updatedBooking,
          remainingAmount: Math.max(
            0,
            updatedBooking.totalAmount - updatedBooking.paidAmount,
          ),
        },
      };
    } catch (error) {
      if (isExclusionConstraintError(error)) {
        return this.markConflictAdmin(
          tenant.id,
          paymentWithBooking,
          now,
          nextPaidAmount,
          nextPaymentStatus,
          'Pembayaran DP terverifikasi bersamaan dengan bentrok slot pada database; dialihkan ke antrean konflik admin',
        );
      }
      throw error;
    }
  }

  async simulateExpire(tenant: Tenant, dto: SimulatePaymentDto) {
    const paymentWithBooking = await this.resolveTargetPayment(tenant.id, dto);
    const { booking } = paymentWithBooking;

    if (paymentWithBooking.status !== PaymentTransactionStatus.PENDING) {
      throw new ConflictException(
        `Pembayaran berstatus ${paymentWithBooking.status} tidak dapat dipaksa kedaluwarsa`,
      );
    }

    if (booking.status !== BookingStatus.HOLD_DP) {
      throw new ConflictException(
        `Booking berstatus ${booking.status} tidak sedang menahan slot DP`,
      );
    }

    const now = this.clock.now();
    const clampedExpiresAt =
      paymentWithBooking.expiresAt &&
      paymentWithBooking.expiresAt.getTime() < now.getTime()
        ? paymentWithBooking.expiresAt
        : now;

    const updatedBooking = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentWithBooking.id },
        data: {
          status: PaymentTransactionStatus.EXPIRED,
          expiresAt: clampedExpiresAt,
        },
      });

      return tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.EXPIRED,
          logs: {
            create: {
              tenantId: tenant.id,
              action: 'DP_HOLD_EXPIRED',
              actorRole: ActorRole.SYSTEM,
              notes:
                'Masa penahanan DP kedaluwarsa (simulasi manual); slot kalender dilepas',
            },
          },
        },
        include: BOOKING_RESULT_INCLUDE,
      });
    });

    this.realtimeEvents.emit({
      event: 'DP_EXPIRED',
      tenantId: updatedBooking.tenantId,
      bookingId: updatedBooking.id,
      bookingCode: updatedBooking.bookingCode,
      unitId: updatedBooking.unitId,
      unitCode: updatedBooking.unit.code,
      status: updatedBooking.status,
      paymentStatus: updatedBooking.paymentStatus,
      startAt: updatedBooking.startAt.toISOString(),
      endAt: updatedBooking.endAt.toISOString(),
      effectiveCheckinDeadline:
        updatedBooking.effectiveCheckinDeadline.toISOString(),
      occurredAt: now.toISOString(),
      summary: 'Masa hold DP kedaluwarsa; slot dilepas',
    });

    return {
      outcome: 'EXPIRED' as const,
      booking: {
        ...updatedBooking,
        remainingAmount: Math.max(
          0,
          updatedBooking.totalAmount - updatedBooking.paidAmount,
        ),
      },
    };
  }

  private async resolveTargetPayment(
    tenantId: string,
    dto: SimulatePaymentDto,
  ): Promise<PaymentWithBooking> {
    if (!dto.paymentId && !dto.bookingCode?.trim()) {
      throw new BadRequestException(
        'Parameter bookingCode atau paymentId wajib diisi',
      );
    }

    if (dto.paymentId) {
      const payment = await this.prisma.payment.findFirst({
        where: {
          id: dto.paymentId,
          tenantId,
        },
        include: PAYMENT_WITH_BOOKING_INCLUDE,
      });

      if (!payment) {
        throw new NotFoundException('Data pembayaran tidak ditemukan');
      }
      return payment;
    }

    const normalizedCode = dto.bookingCode!.trim().toUpperCase();
    const payment = await this.prisma.payment.findFirst({
      where: {
        tenantId,
        type: PaymentType.DP,
        booking: {
          tenantId,
          bookingCode: normalizedCode,
        },
      },
      include: PAYMENT_WITH_BOOKING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      throw new NotFoundException(
        `Pembayaran DP untuk booking "${normalizedCode}" tidak ditemukan`,
      );
    }

    return payment;
  }

  private async hasActiveSlotConflict(
    tenantId: string,
    excludeBookingId: string,
    unitId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<boolean> {
    const [conflictingBooking, conflictingBlock] = await Promise.all([
      this.prisma.booking.findFirst({
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
      this.prisma.scheduleBlock.findFirst({
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

  private async markConflictAdmin(
    tenantId: string,
    paymentWithBooking: PaymentWithBooking,
    now: Date,
    paidAmount: number,
    paymentStatus: BookingPaymentStatus,
    notes: string,
  ) {
    const updatedBooking = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentWithBooking.id },
        data: {
          status: PaymentTransactionStatus.VERIFIED,
          verifiedAt: now,
        },
      });

      return tx.booking.update({
        where: { id: paymentWithBooking.bookingId },
        data: {
          status: BookingStatus.CONFLICT_ADMIN,
          paidAmount,
          paymentStatus,
          logs: {
            create: {
              tenantId,
              action: 'PAYMENT_CONFLICT_ADMIN',
              actorRole: ActorRole.SYSTEM,
              notes,
            },
          },
        },
        include: BOOKING_RESULT_INCLUDE,
      });
    });

    this.realtimeEvents.emit({
      event: 'CONFLICT_ADMIN',
      tenantId: updatedBooking.tenantId,
      bookingId: updatedBooking.id,
      bookingCode: updatedBooking.bookingCode,
      unitId: updatedBooking.unitId,
      unitCode: updatedBooking.unit.code,
      status: updatedBooking.status,
      paymentStatus: updatedBooking.paymentStatus,
      startAt: updatedBooking.startAt.toISOString(),
      endAt: updatedBooking.endAt.toISOString(),
      effectiveCheckinDeadline:
        updatedBooking.effectiveCheckinDeadline.toISOString(),
      occurredAt: now.toISOString(),
      summary: notes,
    });

    return {
      outcome: 'CONFLICT_ADMIN' as const,
      booking: {
        ...updatedBooking,
        remainingAmount: Math.max(
          0,
          updatedBooking.totalAmount - updatedBooking.paidAmount,
        ),
      },
    };
  }
}
