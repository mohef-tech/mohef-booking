import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ClockService } from '../common/clock.service.js';
import {
  BookingPaymentStatus,
  BookingSource,
  BookingStatus,
  DayCategory,
  PaymentMethod,
  PaymentTransactionStatus,
  PaymentType,
  type Tenant,
  UnitType,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RealtimeEventsService } from '../realtime/realtime-events.service.js';
import { BookingOperationsService } from './booking-operations.service.js';

const mockTenant: Tenant = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Mohef PlayStation',
  slug: 'mohef-playstation',
  bookingMode: 'hourly_unit',
  openTime: '10:00',
  closeTime: '23:00',
  dpHoldMinutes: 10,
  gracePeriodMinutes: 15,
  maxGraceExtensionMinutes: 15,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b-1',
    tenantId: mockTenant.id,
    unitId: 'u-1',
    bookingCode: 'MHF-AAAAAA',
    source: BookingSource.ONLINE,
    customerName: 'Andi',
    customerWhatsapp: '08123456789',
    startAt: new Date('2026-12-06T19:00:00+07:00'),
    endAt: new Date('2026-12-06T20:00:00+07:00'),
    actualPlayStartAt: null,
    effectiveCheckinDeadline: new Date('2026-12-06T19:15:00+07:00'),
    graceExtendedCount: 0,
    rescheduleCount: 0,
    status: BookingStatus.CONFIRMED,
    totalAmount: 25000,
    dpAmount: 12500,
    paidAmount: 25000,
    paymentStatus: BookingPaymentStatus.PAID,
    createdAt: new Date(),
    updatedAt: new Date(),
    unit: {
      id: 'u-1',
      code: 'VIP-01',
      name: 'PlayStation VIP #1',
      type: UnitType.VIP,
    },
    payments: [],
    logs: [],
    ...overrides,
  };
}

function makeTxPrisma(tx: Record<string, unknown>): PrismaService {
  return {
    $transaction: vi
      .fn()
      .mockImplementation(
        async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
      ),
  } as unknown as PrismaService;
}

const realtimeMock = { emit: vi.fn() } as unknown as RealtimeEventsService;

describe('BookingOperationsService', () => {
  describe('startPlay ("Pegang Stik")', () => {
    it('shifts endAt to actualPlayStartAt + duration when no next booking exists', async () => {
      const actualStart = new Date('2026-12-06T19:04:00+07:00');
      const clock: ClockService = { now: () => actualStart };
      const booking = makeBooking();

      const update = vi.fn().mockImplementation(async (args) => ({
        ...booking,
        status: args.data.status,
        actualPlayStartAt: args.data.actualPlayStartAt,
        endAt: args.data.endAt,
      }));

      const tx = {
        booking: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(booking)
            .mockResolvedValueOnce(null), // no overlapping next booking
          update,
        },
        scheduleBlock: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      const result = await service.startPlay(mockTenant, 'b-1');

      expect(result.status).toBe(BookingStatus.PLAYING);
      expect(result.actualPlayStartAt?.toISOString()).toBe(
        actualStart.toISOString(),
      );
      expect(result.endAt.toISOString()).toBe(
        new Date('2026-12-06T20:04:00+07:00').toISOString(),
      );
    });

    it('keeps original calendar endAt when a next booking exists on the same unit', async () => {
      const actualStart = new Date('2026-12-06T19:04:00+07:00');
      const clock: ClockService = { now: () => actualStart };
      const booking = makeBooking();

      const update = vi.fn().mockImplementation(async (args) => ({
        ...booking,
        status: args.data.status,
        actualPlayStartAt: args.data.actualPlayStartAt,
        endAt: args.data.endAt,
      }));

      const tx = {
        booking: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(booking)
            .mockResolvedValueOnce({ id: 'b-next' }),
          update,
        },
        scheduleBlock: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      const result = await service.startPlay(mockTenant, 'b-1');

      expect(result.status).toBe(BookingStatus.PLAYING);
      expect(result.endAt.toISOString()).toBe(
        new Date('2026-12-06T20:00:00+07:00').toISOString(),
      );
    });

    it('rejects startPlay if payment has not been settled', async () => {
      const clock: ClockService = {
        now: () => new Date('2026-12-06T19:04:00+07:00'),
      };
      const booking = makeBooking({
        paymentStatus: BookingPaymentStatus.DP_PAID,
        paidAmount: 12500,
      });

      const tx = {
        booking: { findFirst: vi.fn().mockResolvedValue(booking) },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      await expect(service.startPlay(mockTenant, 'b-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('extendGrace', () => {
    it('extends deadline on 60-minute booking when effective remaining time >= 15 minutes', async () => {
      const clock: ClockService = {
        now: () => new Date('2026-12-06T19:10:00+07:00'),
      };
      const booking = makeBooking({
        paidAmount: 12500,
        paymentStatus: BookingPaymentStatus.DP_PAID,
      });

      const update = vi.fn().mockImplementation(async (args) => ({
        ...booking,
        effectiveCheckinDeadline: args.data.effectiveCheckinDeadline,
        graceExtendedCount: args.data.graceExtendedCount,
      }));

      const tx = {
        booking: {
          findFirst: vi.fn().mockResolvedValue(booking),
          update,
        },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      const result = await service.extendGrace(mockTenant, 'b-1', {
        extraMinutes: 10,
      });

      expect(result.graceExtendedCount).toBe(1);
      expect(result.effectiveCheckinDeadline.toISOString()).toBe(
        new Date('2026-12-06T19:25:00+07:00').toISOString(),
      );
    });

    it('rejects grace extension on 30-minute booking because remaining play time < 15 minutes', async () => {
      const clock: ClockService = {
        now: () => new Date('2026-12-06T19:10:00+07:00'),
      };
      const booking30 = makeBooking({
        startAt: new Date('2026-12-06T19:00:00+07:00'),
        endAt: new Date('2026-12-06T19:30:00+07:00'),
        effectiveCheckinDeadline: new Date('2026-12-06T19:15:00+07:00'),
      });

      const tx = {
        booking: { findFirst: vi.fn().mockResolvedValue(booking30) },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      await expect(
        service.extendGrace(mockTenant, 'b-1', { extraMinutes: 5 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reschedule', () => {
    it('rejects reschedule within 60 minutes before startAt', async () => {
      const clock: ClockService = {
        now: () => new Date('2026-12-06T18:15:00+07:00'), // 45m before 19:00
      };
      const booking = makeBooking();

      const tx = {
        booking: { findFirst: vi.fn().mockResolvedValue(booking) },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      await expect(
        service.reschedule(mockTenant, 'b-1', {
          date: '2026-12-07',
          startTime: '19:00',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('extendDuration', () => {
    it('adds 30-minute duration, records payment, and updates total/paid amounts', async () => {
      const clock: ClockService = {
        now: () => new Date('2026-12-06T19:30:00+07:00'),
      };
      const booking = makeBooking({ status: BookingStatus.PLAYING });

      const update = vi.fn().mockImplementation(async (args) => ({
        ...booking,
        endAt: args.data.endAt,
        totalAmount: args.data.totalAmount,
        paidAmount: args.data.paidAmount,
        paymentStatus: args.data.paymentStatus,
      }));

      const tx = {
        booking: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(booking)
            .mockResolvedValueOnce(null),
          update,
        },
        scheduleBlock: { findFirst: vi.fn().mockResolvedValue(null) },
        rateRule: {
          findUnique: vi.fn().mockResolvedValue({
            unitType: UnitType.VIP,
            dayCategory: DayCategory.SUNDAY,
            hourlyRate: 25000,
          }),
        },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      const result = await service.extendDuration(mockTenant, 'b-1', {
        extraMinutes: 30,
        paymentMethod: PaymentMethod.CASH,
      });

      expect(result.endAt.toISOString()).toBe(
        new Date('2026-12-06T20:30:00+07:00').toISOString(),
      );
      expect(result.totalAmount).toBe(37500);
      expect(result.paidAmount).toBe(37500);
    });
  });

  describe('moveUnit', () => {
    it('rejects moving to a unit of a different type (REGULER vs VIP)', async () => {
      const clock: ClockService = {
        now: () => new Date('2026-12-06T19:05:00+07:00'),
      };
      const booking = makeBooking();

      const tx = {
        booking: { findFirst: vi.fn().mockResolvedValue(booking) },
        unit: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'u-reg-1',
            tenantId: mockTenant.id,
            code: 'PS-01',
            type: UnitType.REGULER,
            isActive: true,
          }),
        },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      await expect(
        service.moveUnit(mockTenant, 'b-1', { targetUnitId: 'u-reg-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveConflict & adminCancel', () => {
    it('resolves CONFLICT_ADMIN with REFUND to CANCELLED and records REFUND payment', async () => {
      const clock: ClockService = {
        now: () => new Date('2026-12-06T14:30:00+07:00'),
      };
      const conflictBooking = makeBooking({
        status: BookingStatus.CONFLICT_ADMIN,
        paidAmount: 12500,
        paymentStatus: BookingPaymentStatus.DP_PAID,
      });

      const update = vi.fn().mockImplementation(async (args) => ({
        ...conflictBooking,
        status: args.data.status,
        payments: [
          {
            type: PaymentType.REFUND,
            amount: 12500,
            status: PaymentTransactionStatus.REFUNDED,
          },
        ],
      }));

      const tx = {
        booking: {
          findFirst: vi.fn().mockResolvedValue(conflictBooking),
          update,
        },
      };

      const service = new BookingOperationsService(makeTxPrisma(tx), clock, realtimeMock);
      const result = await service.resolveConflict(mockTenant, 'b-1', {
        action: 'REFUND',
      });

      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.payments[0]).toMatchObject({
        type: PaymentType.REFUND,
        amount: 12500,
        status: PaymentTransactionStatus.REFUNDED,
      });
    });
  });
});
