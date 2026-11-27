import type { UnitType } from "./unit";

export type BookingStatus =
  | "HOLD_DP"
  | "EXPIRED"
  | "CONFIRMED"
  | "PLAYING"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED"
  | "CONFLICT_REVIEW";

export type BookingChannel = "ONLINE" | "CHAT" | "WALK_IN";

export type PaymentStatus =
  | "PENDING"
  | "PAID"
  | "EXPIRED"
  | "REFUNDED"
  | "CONFLICT";

export type PaymentType =
  | "DP_50"
  | "SETTLEMENT_50"
  | "WALK_IN_FULL"
  | "EXTEND";

export interface BookingDto {
  id: string;
  tenantId: string;
  bookingCode: string;
  unitId: string;
  unitName: string;
  unitType: UnitType;
  channel: BookingChannel;
  status: BookingStatus;
  customerName: string | null;
  customerWhatsapp: string | null;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  checkinDeadlineAt: string | null;
  graceExtendedMinutes: number;
  actualPlayStartAt: string | null;
  actualPlayEndAt: string | null;
  totalAmount: number;
  dpAmount: number;
  remainingAmount: number;
  rescheduleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOnlineBookingDto {
  unitType: UnitType;
  unitId?: string | null;
  startAt: string;
  durationMinutes: number;
  customerName: string;
  customerWhatsapp: string;
}

export interface CreateWalkInBookingDto {
  unitId: string;
  durationMinutes: number;
  customerName?: string;
  customerWhatsapp?: string;
}

export interface RescheduleBookingDto {
  startAt: string;
  durationMinutes: number;
  unitId?: string | null;
}

export interface ExtendBookingDto {
  additionalMinutes: number;
}

export interface MoveUnitDto {
  targetUnitId: string;
}

export interface ExtendGraceDto {
  extraMinutes: number;
}

export interface HealthResponse {
  status: "ok" | "error";
  database: "connected" | "disconnected";
  timestamp: string;
}
