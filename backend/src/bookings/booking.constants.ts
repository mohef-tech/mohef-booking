import type { Prisma } from '../generated/prisma/client.js';
import type {
  RealtimeBookingEvent,
  RealtimeEventType,
} from '../realtime/realtime.types.js';

export const BOOKING_DETAIL_INCLUDE = {
  unit: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'asc' as const },
  },
  logs: {
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.BookingInclude;

export type BookingWithDetails = Prisma.BookingGetPayload<{
  include: typeof BOOKING_DETAIL_INCLUDE;
}>;

export type BookingDetailResponse = BookingWithDetails & {
  remainingAmount: number;
};

export function attachRemainingAmount(
  booking: BookingWithDetails,
): BookingDetailResponse {
  return {
    ...booking,
    remainingAmount: Math.max(0, booking.totalAmount - booking.paidAmount),
  };
}

export function buildRealtimeBookingEvent(
  event: RealtimeEventType,
  booking: BookingWithDetails,
  occurredAt: Date,
  summary?: string,
): RealtimeBookingEvent {
  return {
    event,
    tenantId: booking.tenantId,
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    unitId: booking.unitId,
    unitCode: booking.unit?.code,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    effectiveCheckinDeadline: booking.effectiveCheckinDeadline.toISOString(),
    occurredAt: occurredAt.toISOString(),
    ...(summary ? { summary } : {}),
  };
}
