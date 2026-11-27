import type { MessageEvent } from '@nestjs/common';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../generated/prisma/client.js';
import { RealtimeEventsService } from './realtime-events.service.js';

describe('RealtimeEventsService', () => {
  it('emits connected handshake and filters events by tenantId', async () => {
    const service = new RealtimeEventsService();

    const collectedPromise = firstValueFrom(
      service.streamForTenant('tenant-1').pipe(take(2), toArray()),
    );

    // Event for another tenant must be ignored
    service.emit({
      event: 'BOOKING_CREATED',
      tenantId: 'tenant-2',
      bookingId: 'b-other',
      bookingCode: 'MHF-OTHER1',
      unitId: 'u-other',
      status: BookingStatus.HOLD_DP,
      paymentStatus: BookingPaymentStatus.UNPAID,
      startAt: '2030-03-03T12:00:00.000Z',
      endAt: '2030-03-03T13:00:00.000Z',
      effectiveCheckinDeadline: '2030-03-03T12:15:00.000Z',
      occurredAt: '2030-03-03T07:00:00.000Z',
    });

    // Event for tenant-1 must be delivered
    service.emit({
      event: 'DP_VERIFIED',
      tenantId: 'tenant-1',
      bookingId: 'b-1',
      bookingCode: 'MHF-T1ABCD',
      unitId: 'u-1',
      unitCode: 'VIP-01',
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.DP_PAID,
      startAt: '2030-03-03T12:00:00.000Z',
      endAt: '2030-03-03T13:00:00.000Z',
      effectiveCheckinDeadline: '2030-03-03T12:15:00.000Z',
      occurredAt: '2030-03-03T07:05:00.000Z',
      summary: 'DP terverifikasi',
    });

    const events: MessageEvent[] = await collectedPromise;
    expect(events[0]).toEqual({ comment: 'connected' });
    expect(events[1]).toMatchObject({
      type: 'DP_VERIFIED',
      data: {
        tenantId: 'tenant-1',
        bookingCode: 'MHF-T1ABCD',
        status: BookingStatus.CONFIRMED,
      },
    });
  });
});
