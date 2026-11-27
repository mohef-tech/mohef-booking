import { BadRequestException } from '@nestjs/common';
import { BookingStatus, DayCategory } from '../generated/prisma/client.js';

export const JAKARTA_TIMEZONE = 'Asia/Jakarta';
export const SLOT_INTERVAL_MINUTES = 30;
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.HOLD_DP,
  BookingStatus.CONFIRMED,
  BookingStatus.PLAYING,
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export interface ParsedCalendarDate {
  date: string;
  year: number;
  month: number;
  day: number;
}

export interface SlotPricingBreakdown {
  dayCategory: DayCategory;
  hourlyRate: number;
  totalAmount: number;
  dpAmount: number;
  remainingAmount: number;
}

export function parseCalendarDate(dateStr: string): ParsedCalendarDate {
  const match = DATE_PATTERN.exec(dateStr);
  if (!match) {
    throw new BadRequestException('Format tanggal harus YYYY-MM-DD');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new BadRequestException(`Tanggal "${dateStr}" tidak valid`);
  }

  return { date: dateStr, year, month, day };
}

export function parseTimeToMinutes(
  timeStr: string,
  options: { allowEndOfDay?: boolean } = {},
): number {
  const match = TIME_PATTERN.exec(timeStr);
  if (!match) {
    throw new BadRequestException(`Format waktu "${timeStr}" harus HH:mm`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (options.allowEndOfDay && hours === 24 && minutes === 0) {
    return 24 * 60;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new BadRequestException(`Nilai waktu "${timeStr}" tidak valid`);
  }

  return hours * 60 + minutes;
}

export function formatMinutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function getJakartaDayBounds(dateStr: string): {
  dayStart: Date;
  dayEnd: Date;
} {
  parseCalendarDate(dateStr);
  // Asia/Jakarta is fixed at UTC+07:00 without DST
  const dayStart = new Date(`${dateStr}T00:00:00+07:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

export function detectJakartaDayCategory(dateStr: string): DayCategory {
  const { year, month, day } = parseCalendarDate(dateStr);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 ? DayCategory.SUNDAY : DayCategory.WEEKDAY;
}

export function validateSlotGridAndOperatingHours(params: {
  date: string;
  startTime: string;
  durationMinutes: number;
  openTime: string;
  closeTime: string;
}): {
  startAt: Date;
  endAt: Date;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
} {
  parseCalendarDate(params.date);
  const startMinutes = parseTimeToMinutes(params.startTime);

  if (startMinutes % SLOT_INTERVAL_MINUTES !== 0) {
    throw new BadRequestException(
      'Jam mulai harus berada pada kelipatan 30 menit (contoh: 10:00 atau 10:30)',
    );
  }

  if (
    !Number.isInteger(params.durationMinutes) ||
    params.durationMinutes < SLOT_INTERVAL_MINUTES ||
    params.durationMinutes % SLOT_INTERVAL_MINUTES !== 0
  ) {
    throw new BadRequestException(
      'Durasi pemesanan minimal 30 menit dan harus kelipatan 30 menit',
    );
  }

  const openMinutes = parseTimeToMinutes(params.openTime);
  const closeMinutes = parseTimeToMinutes(params.closeTime, {
    allowEndOfDay: true,
  });
  const endMinutes = startMinutes + params.durationMinutes;

  if (startMinutes < openMinutes || endMinutes > closeMinutes) {
    throw new BadRequestException(
      `Jadwal harus berada dalam jam operasional (${params.openTime}-${params.closeTime} WIB)`,
    );
  }

  const startAt = new Date(`${params.date}T${params.startTime}:00+07:00`);
  const endAt = new Date(startAt.getTime() + params.durationMinutes * 60 * 1000);

  return {
    startAt,
    endAt,
    endTime: formatMinutesToTime(endMinutes),
    startMinutes,
    endMinutes,
  };
}

export function calculateSlotPricing(
  hourlyRate: number,
  durationMinutes: number,
  dayCategory: DayCategory,
): SlotPricingBreakdown {
  if (!Number.isInteger(hourlyRate) || hourlyRate <= 0) {
    throw new BadRequestException('Tarif per jam tidak valid');
  }
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < SLOT_INTERVAL_MINUTES ||
    durationMinutes % SLOT_INTERVAL_MINUTES !== 0
  ) {
    throw new BadRequestException(
      'Durasi pemesanan minimal 30 menit dan harus kelipatan 30 menit',
    );
  }

  const totalAmount = Math.round((hourlyRate * durationMinutes) / 60);
  const dpAmount = Math.ceil(totalAmount / 2);
  const remainingAmount = totalAmount - dpAmount;

  return {
    dayCategory,
    hourlyRate,
    totalAmount,
    dpAmount,
    remainingAmount,
  };
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function buildJakartaBookingInterval(params: {
  date: string;
  startTime: string;
  durationMinutes: number;
  openTime: string;
  closeTime: string;
  gracePeriodMinutes: number;
}): {
  startAt: Date;
  endAt: Date;
  effectiveCheckinDeadline: Date;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
} {
  const slot = validateSlotGridAndOperatingHours(params);
  const effectiveCheckinDeadline = new Date(
    slot.startAt.getTime() + params.gracePeriodMinutes * 60 * 1000,
  );

  return {
    ...slot,
    effectiveCheckinDeadline,
  };
}

export function getCurrentJakartaSlot(now: Date = new Date()): {
  date: string;
  startTime: string;
  startAt: Date;
  endAt: Date;
} {
  // Shift UTC ms by +7h (Asia/Jakarta fixed offset) to read local wall-clock date/time safely
  const jakartaMs = now.getTime() + 7 * 60 * 60 * 1000;
  const jakartaDate = new Date(jakartaMs);

  const year = jakartaDate.getUTCFullYear();
  const month = String(jakartaDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jakartaDate.getUTCDate()).padStart(2, '0');
  const hours = jakartaDate.getUTCHours();
  const flooredMinute = jakartaDate.getUTCMinutes() < 30 ? 0 : 30;

  const date = `${year}-${month}-${day}`;
  const startTime = `${String(hours).padStart(2, '0')}:${String(flooredMinute).padStart(2, '0')}`;
  const startAt = new Date(`${date}T${startTime}:00+07:00`);
  const endAt = new Date(startAt.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000);

  return { date, startTime, startAt, endAt };
}

export function getJakartaDateString(date: Date): string {
  const jakartaDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const year = jakartaDate.getUTCFullYear();
  const month = String(jakartaDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jakartaDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getJakartaClosingDateTime(
  referenceDate: Date,
  closeTime: string,
): Date {
  const dateStr = getJakartaDateString(referenceDate);
  const { dayStart } = getJakartaDayBounds(dateStr);
  const closeMinutes = parseTimeToMinutes(closeTime, { allowEndOfDay: true });
  return new Date(dayStart.getTime() + closeMinutes * 60 * 1000);
}
