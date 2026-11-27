import { BadRequestException } from '@nestjs/common';
import { DayCategory } from '../generated/prisma/client.js';
import {
  calculateSlotPricing,
  detectJakartaDayCategory,
  intervalsOverlap,
  validateSlotGridAndOperatingHours,
} from './time-slot.util.js';

describe('time-slot.util', () => {
  describe('detectJakartaDayCategory', () => {
    it('detects Sunday as SUNDAY and Monday-Saturday as WEEKDAY', () => {
      expect(detectJakartaDayCategory('2026-11-28')).toBe(DayCategory.WEEKDAY); // Saturday
      expect(detectJakartaDayCategory('2026-11-29')).toBe(DayCategory.SUNDAY); // Sunday
      expect(detectJakartaDayCategory('2026-11-30')).toBe(DayCategory.WEEKDAY); // Monday
    });

    it('rejects impossible calendar dates', () => {
      expect(() => detectJakartaDayCategory('2026-02-30')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateSlotGridAndOperatingHours', () => {
    it('accepts valid 30-minute grid slots inside operating hours', () => {
      const result = validateSlotGridAndOperatingHours({
        date: '2026-11-29',
        startTime: '19:30',
        durationMinutes: 90,
        openTime: '10:00',
        closeTime: '23:00',
      });

      expect(result.endTime).toBe('21:00');
      expect(result.startAt.toISOString()).toBe('2026-11-29T12:30:00.000Z');
      expect(result.endAt.toISOString()).toBe('2026-11-29T14:00:00.000Z');
    });

    it('rejects start times not aligned to 30-minute grid', () => {
      expect(() =>
        validateSlotGridAndOperatingHours({
          date: '2026-11-29',
          startTime: '19:15',
          durationMinutes: 60,
          openTime: '10:00',
          closeTime: '23:00',
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects durations below 30 minutes or not multiple of 30', () => {
      expect(() =>
        validateSlotGridAndOperatingHours({
          date: '2026-11-29',
          startTime: '19:00',
          durationMinutes: 15,
          openTime: '10:00',
          closeTime: '23:00',
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        validateSlotGridAndOperatingHours({
          date: '2026-11-29',
          startTime: '19:00',
          durationMinutes: 45,
          openTime: '10:00',
          closeTime: '23:00',
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects slots outside operating hours', () => {
      expect(() =>
        validateSlotGridAndOperatingHours({
          date: '2026-11-29',
          startTime: '09:30',
          durationMinutes: 60,
          openTime: '10:00',
          closeTime: '23:00',
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        validateSlotGridAndOperatingHours({
          date: '2026-11-29',
          startTime: '22:30',
          durationMinutes: 60,
          openTime: '10:00',
          closeTime: '23:00',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('calculateSlotPricing', () => {
    it('calculates proportional 30-minute rate and 50% DP split', () => {
      expect(calculateSlotPricing(10000, 30, DayCategory.WEEKDAY)).toEqual({
        dayCategory: DayCategory.WEEKDAY,
        hourlyRate: 10000,
        totalAmount: 5000,
        dpAmount: 2500,
        remainingAmount: 2500,
      });

      expect(calculateSlotPricing(25000, 30, DayCategory.SUNDAY)).toEqual({
        dayCategory: DayCategory.SUNDAY,
        hourlyRate: 25000,
        totalAmount: 12500,
        dpAmount: 6250,
        remainingAmount: 6250,
      });
    });
  });

  describe('intervalsOverlap', () => {
    it('allows back-to-back half-open intervals and flags real overlaps', () => {
      const s1 = new Date('2026-11-29T19:00:00+07:00');
      const e1 = new Date('2026-11-29T20:00:00+07:00');
      const s2 = new Date('2026-11-29T20:00:00+07:00');
      const e2 = new Date('2026-11-29T21:00:00+07:00');
      const s3 = new Date('2026-11-29T19:30:00+07:00');
      const e3 = new Date('2026-11-29T20:30:00+07:00');

      expect(intervalsOverlap(s1, e1, s2, e2)).toBe(false);
      expect(intervalsOverlap(s1, e1, s3, e3)).toBe(true);
    });
  });
});
