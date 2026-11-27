import { generateBookingCode } from './booking-code.util.js';
import { buildJakartaBookingInterval } from './time-slot.util.js';

describe('booking-code.util & Jakarta interval builder', () => {
  it('generates MHF-XXXXXX codes without ambiguous characters 0/O/1/I', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateBookingCode();
      expect(code).toMatch(/^MHF-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      expect(code).not.toMatch(/[0O1I]/);
    }
  });

  it('builds startAt, endAt, and effectiveCheckinDeadline in Asia/Jakarta', () => {
    const interval = buildJakartaBookingInterval({
      date: '2026-12-06',
      startTime: '19:00',
      durationMinutes: 60,
      openTime: '10:00',
      closeTime: '23:00',
      gracePeriodMinutes: 15,
    });

    expect(interval.startAt.toISOString()).toBe('2026-12-06T12:00:00.000Z');
    expect(interval.endAt.toISOString()).toBe('2026-12-06T13:00:00.000Z');
    expect(interval.effectiveCheckinDeadline.toISOString()).toBe(
      '2026-12-06T12:15:00.000Z',
    );
  });
});
