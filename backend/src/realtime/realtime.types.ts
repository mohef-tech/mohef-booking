import type {
  BookingPaymentStatus,
  BookingStatus,
} from '../generated/prisma/client.js';

export type RealtimeEventType =
  | 'BOOKING_CREATED'
  | 'DP_VERIFIED'
  | 'DP_EXPIRED'
  | 'GRACE_EXTENDED'
  | 'CHECKED_IN'
  | 'PLAY_STARTED'
  | 'SLOT_RELEASED_NO_SHOW'
  | 'CONFLICT_ADMIN'
  | 'BOOKING_UPDATED';

export interface RealtimeBookingEvent {
  event: RealtimeEventType;
  tenantId: string;
  bookingId: string;
  bookingCode: string;
  unitId: string;
  unitCode?: string;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  startAt: string;
  endAt: string;
  effectiveCheckinDeadline: string;
  occurredAt: string;
  summary?: string;
}
