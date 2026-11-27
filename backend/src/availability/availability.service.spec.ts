import { DayCategory, type Tenant, UnitType } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AvailabilityService } from './availability.service.js';

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

describe('AvailabilityService', () => {
  it('filters out units occupied by active bookings and returns Sunday pricing', async () => {
    const prismaMock = {
      unit: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'u-1', code: 'PS-01', name: 'PS #1', type: UnitType.REGULER },
          { id: 'u-2', code: 'PS-02', name: 'PS #2', type: UnitType.REGULER },
        ]),
      },
      rateRule: {
        findUnique: vi.fn().mockResolvedValue({
          hourlyRate: 12000,
          unitType: UnitType.REGULER,
          dayCategory: DayCategory.SUNDAY,
        }),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([
          {
            unitId: 'u-1',
            startAt: new Date('2026-11-29T19:00:00+07:00'),
            endAt: new Date('2026-11-29T20:00:00+07:00'),
          },
        ]),
      },
      scheduleBlock: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const service = new AvailabilityService(prismaMock);
    const result = await service.checkSlot(mockTenant, {
      date: '2026-11-29', // Sunday
      startTime: '19:00',
      durationMinutes: 60,
      unitType: UnitType.REGULER,
    });

    expect(result.available).toBe(true);
    expect(result.availableUnits).toEqual([
      { id: 'u-2', code: 'PS-02', name: 'PS #2', type: UnitType.REGULER },
    ]);
    expect(result.pricing).toEqual({
      dayCategory: DayCategory.SUNDAY,
      hourlyRate: 12000,
      totalAmount: 12000,
      dpAmount: 6000,
      remainingAmount: 6000,
    });
  });

  it('marks slot unavailable when a whole-venue schedule block overlaps', async () => {
    const prismaMock = {
      unit: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'u-vip-1', code: 'VIP-01', name: 'VIP #1', type: UnitType.VIP },
        ]),
      },
      rateRule: {
        findUnique: vi.fn().mockResolvedValue({
          hourlyRate: 20000,
          unitType: UnitType.VIP,
          dayCategory: DayCategory.WEEKDAY,
        }),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      scheduleBlock: {
        findMany: vi.fn().mockResolvedValue([
          {
            unitId: null,
            startAt: new Date('2026-11-28T18:00:00+07:00'),
            endAt: new Date('2026-11-28T22:00:00+07:00'),
            reason: 'Maintenance Listrik',
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new AvailabilityService(prismaMock);
    const result = await service.checkSlot(mockTenant, {
      date: '2026-11-28', // Saturday -> WEEKDAY
      startTime: '19:00',
      durationMinutes: 60,
      unitType: UnitType.VIP,
    });

    expect(result.available).toBe(false);
    expect(result.availableUnits).toEqual([]);
    expect(result.unavailableReason).toContain('Maintenance Listrik');
    expect(result.pricing).toEqual({
      dayCategory: DayCategory.WEEKDAY,
      hourlyRate: 20000,
      totalAmount: 20000,
      dpAmount: 10000,
      remainingAmount: 10000,
    });
  });

  it('marks specific unit unavailable when unit-level block overlaps, and allows adjacent booking', async () => {
    const prismaMock = {
      unit: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'u-1',
          code: 'PS-01',
          name: 'PS #1',
          type: UnitType.REGULER,
          isActive: true,
        }),
      },
      rateRule: {
        findUnique: vi.fn().mockResolvedValue({
          hourlyRate: 10000,
          unitType: UnitType.REGULER,
          dayCategory: DayCategory.WEEKDAY,
        }),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([
          {
            unitId: 'u-1',
            startAt: new Date('2026-11-28T18:00:00+07:00'),
            endAt: new Date('2026-11-28T19:00:00+07:00'), // adjacent, should NOT block 19:00-20:00
          },
        ]),
      },
      scheduleBlock: {
        findMany: vi.fn().mockResolvedValue([
          {
            unitId: 'u-1',
            startAt: new Date('2026-11-28T19:30:00+07:00'),
            endAt: new Date('2026-11-28T20:30:00+07:00'),
            reason: 'Servis Stik',
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new AvailabilityService(prismaMock);
    const result = await service.checkSlot(mockTenant, {
      date: '2026-11-28',
      startTime: '19:00',
      durationMinutes: 60,
      unitId: 'u-1',
    });

    expect(result.available).toBe(false);
    expect(result.unavailableReason).toContain('Servis Stik');
  });
});
