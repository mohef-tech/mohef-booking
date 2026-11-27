import type { ClockService } from '../common/clock.service.js';
import {
  BookingPaymentStatus,
  BookingSource,
  BookingStatus,
  PaymentTransactionStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RealtimeEventsService } from '../realtime/realtime-events.service.js';
import { BookingAutomationService } from './booking-automation.service.js';

describe('BookingAutomationService', () => {
  const fixedClock: ClockService = {
    now: () => new Date('2030-03-03T19:36:00+07:00'),
  };

  it('sweeps expired DP holds to CANCELLED + EXPIRED payment and emits DP_EXPIRED', async () => {
    const emit = vi.fn();
    const realtime = { emit } as unknown as RealtimeEventsService;

    const expiredCandidate = {
      id: 'b-hold',
      tenantId: 't-1',
      unitId: 'u-1',
      bookingCode: 'MHF-HOLD01',
      source: BookingSource.ONLINE,
      status: BookingStatus.HOLD_DP,
      paymentStatus: BookingPaymentStatus.UNPAID,
      startAt: new Date('2030-03-03T20:00:00+07:00'),
      endAt: new Date('2030-03-03T21:00:00+07:00'),
      effectiveCheckinDeadline: new Date('2030-03-03T20:15:00+07:00'),
      unit: { code: 'PS-01' },
      payments: [{ id: 'p-1' }],
    };

    const bookingUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const bookingLogCreate = vi.fn().mockResolvedValue({});

    const prismaMock = {
      booking: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([expiredCandidate]) // expired DP holds
          .mockResolvedValueOnce([]), // no-shows
      },
      $transaction: vi
        .fn()
        .mockImplementation(
          async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              booking: { updateMany: bookingUpdateMany },
              payment: { updateMany: paymentUpdateMany },
              bookingLog: { create: bookingLogCreate },
            }),
        ),
    } as unknown as PrismaService;

    const service = new BookingAutomationService(
      prismaMock,
      fixedClock,
      realtime,
    );
    const summary = await service.runSweep(fixedClock.now());

    expect(summary).toMatchObject({
      expiredHoldCount: 1,
      noShowCount: 0,
    });
    expect(bookingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: BookingStatus.CANCELLED },
      }),
    );
    expect(paymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: PaymentTransactionStatus.EXPIRED },
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'DP_EXPIRED',
        bookingCode: 'MHF-HOLD01',
        status: BookingStatus.CANCELLED,
      }),
    );
  });

  it('reopens slot on no-show when remaining time >= 30m and blocks remainder when < 30m', async () => {
    const emit = vi.fn();
    const realtime = { emit } as unknown as RealtimeEventsService;

    const reopenCandidate = {
      id: 'b-reopen',
      tenantId: 't-1',
      unitId: 'u-1',
      bookingCode: 'MHF-REOPEN',
      source: BookingSource.ONLINE,
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.DP_PAID,
      startAt: new Date('2030-03-03T19:00:00+07:00'),
      endAt: new Date('2030-03-03T20:00:00+07:00'),
      effectiveCheckinDeadline: new Date('2030-03-03T19:15:00+07:00'), // 45m remaining
      unit: { code: 'PS-01' },
    };

    const shortCandidate = {
      id: 'b-short',
      tenantId: 't-1',
      unitId: 'u-2',
      bookingCode: 'MHF-SHORT1',
      source: BookingSource.ONLINE,
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.DP_PAID,
      startAt: new Date('2030-03-03T19:00:00+07:00'),
      endAt: new Date('2030-03-03T20:00:00+07:00'),
      effectiveCheckinDeadline: new Date('2030-03-03T19:35:00+07:00'), // 25m remaining (< 30m)
      unit: { code: 'PS-02' },
    };

    const scheduleBlockCreate = vi.fn().mockResolvedValue({});
    const bookingLogCreate = vi.fn().mockResolvedValue({});

    const prismaMock = {
      booking: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([]) // expired DP holds
          .mockResolvedValueOnce([reopenCandidate, shortCandidate]), // no-shows
      },
      $transaction: vi
        .fn()
        .mockImplementation(
          async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              booking: {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
              },
              scheduleBlock: { create: scheduleBlockCreate },
              bookingLog: { create: bookingLogCreate },
            }),
        ),
    } as unknown as PrismaService;

    const service = new BookingAutomationService(
      prismaMock,
      fixedClock,
      realtime,
    );
    const summary = await service.runSweep(fixedClock.now());

    expect(summary).toMatchObject({
      expiredHoldCount: 0,
      noShowCount: 2,
      reopenedSlotCount: 1,
      blockedShortRemainderCount: 1,
    });
    expect(scheduleBlockCreate).toHaveBeenCalledTimes(1);
    expect(scheduleBlockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitId: 'u-2',
          startAt: shortCandidate.effectiveCheckinDeadline,
          endAt: shortCandidate.endAt,
        }),
      }),
    );
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'SLOT_RELEASED_NO_SHOW',
        bookingCode: 'MHF-REOPEN',
      }),
    );
  });
});
