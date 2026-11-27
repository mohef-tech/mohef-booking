import type { ClockService } from '../common/clock.service.js';
import {
  BookingPaymentStatus,
  BookingStatus,
  PaymentTransactionStatus,
  PaymentType,
  type Tenant,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RealtimeEventsService } from '../realtime/realtime-events.service.js';
import { PaymentsService } from './payments.service.js';

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

describe('PaymentsService', () => {
  const realtimeMock = { emit: vi.fn() } as unknown as RealtimeEventsService;

  it('marks booking CONFIRMED and DP_PAID when verified before expiresAt', async () => {
    const now = new Date('2026-12-06T14:05:00+07:00');
    const clock: ClockService = { now: () => now };

    const paymentUpdate = vi.fn().mockResolvedValue({});
    const bookingUpdate = vi.fn().mockResolvedValue({
      id: 'b-1',
      tenantId: mockTenant.id,
      unitId: 'u-1',
      bookingCode: 'MHF-AAAAAA',
      status: BookingStatus.CONFIRMED,
      startAt: new Date('2026-12-06T19:00:00+07:00'),
      endAt: new Date('2026-12-06T20:00:00+07:00'),
      effectiveCheckinDeadline: new Date('2026-12-06T19:15:00+07:00'),
      totalAmount: 20000,
      dpAmount: 10000,
      paidAmount: 10000,
      paymentStatus: BookingPaymentStatus.DP_PAID,
      unit: { id: 'u-1', code: 'VIP-01', name: 'VIP #1', type: 'VIP' },
      payments: [{ id: 'p-1', status: PaymentTransactionStatus.VERIFIED }],
      logs: [{ action: 'DP_PAYMENT_VERIFIED' }],
    });

    const prismaMock = {
      payment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'p-1',
          tenantId: mockTenant.id,
          bookingId: 'b-1',
          type: PaymentType.DP,
          amount: 10000,
          status: PaymentTransactionStatus.PENDING,
          expiresAt: new Date('2026-12-06T14:10:00+07:00'),
          booking: {
            id: 'b-1',
            unitId: 'u-1',
            status: BookingStatus.HOLD_DP,
            startAt: new Date('2026-12-06T19:00:00+07:00'),
            endAt: new Date('2026-12-06T20:00:00+07:00'),
            totalAmount: 20000,
            paidAmount: 0,
          },
        }),
      },
      $transaction: vi
        .fn()
        .mockImplementation(
          async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              payment: { update: paymentUpdate },
              booking: { update: bookingUpdate },
            }),
        ),
    } as unknown as PrismaService;

    const service = new PaymentsService(prismaMock, clock, realtimeMock);
    const result = await service.simulateVerify(mockTenant, {
      bookingCode: 'MHF-AAAAAA',
    });

    expect(result.outcome).toBe('CONFIRMED');
    expect(result.booking.status).toBe(BookingStatus.CONFIRMED);
    expect(result.booking.paymentStatus).toBe(BookingPaymentStatus.DP_PAID);
    expect(result.booking.remainingAmount).toBe(10000);
  });

  it('routes late payment to CONFLICT_ADMIN without overwriting active booking', async () => {
    const now = new Date('2026-12-06T14:15:00+07:00'); // after expiresAt
    const clock: ClockService = { now: () => now };

    const paymentUpdate = vi.fn().mockResolvedValue({});
    const bookingUpdate = vi.fn().mockResolvedValue({
      id: 'b-1',
      tenantId: mockTenant.id,
      unitId: 'u-1',
      bookingCode: 'MHF-EXPRD1',
      status: BookingStatus.CONFLICT_ADMIN,
      startAt: new Date('2026-12-06T19:00:00+07:00'),
      endAt: new Date('2026-12-06T20:00:00+07:00'),
      effectiveCheckinDeadline: new Date('2026-12-06T19:15:00+07:00'),
      totalAmount: 20000,
      dpAmount: 10000,
      paidAmount: 10000,
      paymentStatus: BookingPaymentStatus.DP_PAID,
      unit: { id: 'u-1', code: 'VIP-01', name: 'VIP #1', type: 'VIP' },
      payments: [{ id: 'p-1', status: PaymentTransactionStatus.VERIFIED }],
      logs: [{ action: 'PAYMENT_CONFLICT_ADMIN' }],
    });

    const prismaMock = {
      payment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'p-1',
          tenantId: mockTenant.id,
          bookingId: 'b-1',
          type: PaymentType.DP,
          amount: 10000,
          status: PaymentTransactionStatus.EXPIRED,
          expiresAt: new Date('2026-12-06T14:10:00+07:00'),
          booking: {
            id: 'b-1',
            unitId: 'u-1',
            status: BookingStatus.EXPIRED,
            startAt: new Date('2026-12-06T19:00:00+07:00'),
            endAt: new Date('2026-12-06T20:00:00+07:00'),
            totalAmount: 20000,
            paidAmount: 0,
          },
        }),
      },
      booking: {
        findFirst: vi.fn().mockResolvedValue({ id: 'b-other-active' }),
      },
      scheduleBlock: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi
        .fn()
        .mockImplementation(
          async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              payment: { update: paymentUpdate },
              booking: { update: bookingUpdate },
            }),
        ),
    } as unknown as PrismaService;

    const service = new PaymentsService(prismaMock, clock, realtimeMock);
    const result = await service.simulateVerify(mockTenant, {
      paymentId: 'p-1',
    });

    expect(result.outcome).toBe('CONFLICT_ADMIN');
    expect(result.booking.status).toBe(BookingStatus.CONFLICT_ADMIN);
    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentTransactionStatus.VERIFIED,
        }),
      }),
    );
  });
});
