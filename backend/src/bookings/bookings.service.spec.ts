import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ClockService } from '../common/clock.service.js';
import {
  BookingPaymentStatus,
  BookingSource,
  BookingStatus,
  DayCategory,
  PaymentMethod,
  type Tenant,
  UnitType,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RealtimeEventsService } from '../realtime/realtime-events.service.js';
import { BookingsService } from './bookings.service.js';

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

describe('BookingsService', () => {
  const fixedClock: ClockService = {
    now: () => new Date('2026-12-06T14:10:00+07:00'),
  };
  const realtimeMock = { emit: vi.fn() } as unknown as RealtimeEventsService;

  it('maps PostgreSQL exclusion constraint 23P01 to ConflictException (409)', async () => {
    const unitId = '00000000-0000-0000-0000-000000000011';
    const prismaMock = {
      unit: {
        findFirst: vi.fn().mockResolvedValue({
          id: unitId,
          code: 'PS-01',
          type: UnitType.REGULER,
          isActive: true,
        }),
      },
      rateRule: {
        findUnique: vi.fn().mockResolvedValue({
          hourlyRate: 12000,
          unitType: UnitType.REGULER,
          dayCategory: DayCategory.SUNDAY,
        }),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      scheduleBlock: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn().mockRejectedValue({
        code: 'P2004',
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23P01',
              message:
                'conflicting key value violates exclusion constraint "bookings_no_overlap_active_excl"',
            },
          },
        },
      }),
    } as unknown as PrismaService;

    const service = new BookingsService(prismaMock, fixedClock, realtimeMock);

    await expect(
      service.createOnlineBooking(mockTenant, {
        date: '2026-12-06',
        startTime: '19:00',
        durationMinutes: 60,
        unitId,
        customerName: 'Budi',
        customerWhatsapp: '08123456789',
        paymentMethod: 'QRIS',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects walk-in request for future slot outside current running 30-min window', async () => {
    const prismaMock = {} as unknown as PrismaService;
    const service = new BookingsService(prismaMock, fixedClock, realtimeMock);

    await expect(
      service.createWalkInBooking(mockTenant, {
        date: '2026-12-06',
        startTime: '16:00', // 2 hours ahead of 14:10 WIB
        durationMinutes: 60,
        unitType: UnitType.REGULER,
        paymentMethod: PaymentMethod.CASH,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates walk-in booking on current running slot with DIRECT_FULL PAID', async () => {
    const unitId = '00000000-0000-0000-0000-000000000011';
    const createdBooking = {
      id: 'b-walkin',
      tenantId: mockTenant.id,
      unitId,
      bookingCode: 'MHF-ABCDEF',
      source: BookingSource.WALK_IN,
      customerName: null,
      customerWhatsapp: null,
      startAt: new Date('2026-12-06T14:00:00+07:00'),
      endAt: new Date('2026-12-06T15:00:00+07:00'),
      actualPlayStartAt: null,
      effectiveCheckinDeadline: new Date('2026-12-06T14:15:00+07:00'),
      graceExtendedCount: 0,
      rescheduleCount: 0,
      status: BookingStatus.CONFIRMED,
      totalAmount: 12000,
      dpAmount: 0,
      paidAmount: 12000,
      paymentStatus: BookingPaymentStatus.PAID,
      createdAt: new Date(),
      updatedAt: new Date(),
      unit: { id: unitId, code: 'PS-01', name: 'PS #1', type: UnitType.REGULER },
      payments: [],
      logs: [],
    };

    const prismaMock = {
      unit: {
        findMany: vi.fn().mockResolvedValue([{ id: unitId }]),
      },
      rateRule: {
        findUnique: vi.fn().mockResolvedValue({
          hourlyRate: 12000,
          unitType: UnitType.REGULER,
          dayCategory: DayCategory.SUNDAY,
        }),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      scheduleBlock: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi
        .fn()
        .mockImplementation(
          async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              scheduleBlock: { findFirst: vi.fn().mockResolvedValue(null) },
              booking: { create: vi.fn().mockResolvedValue(createdBooking) },
            }),
        ),
    } as unknown as PrismaService;

    const service = new BookingsService(prismaMock, fixedClock, realtimeMock);
    const result = await service.createWalkInBooking(mockTenant, {
      durationMinutes: 60,
      unitType: UnitType.REGULER,
      paymentMethod: PaymentMethod.CASH,
    });

    expect(result.status).toBe(BookingStatus.CONFIRMED);
    expect(result.paymentStatus).toBe(BookingPaymentStatus.PAID);
    expect(result.remainingAmount).toBe(0);
  });
});
