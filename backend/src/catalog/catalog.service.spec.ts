import { ConflictException } from '@nestjs/common';
import { type Tenant, UnitType } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService } from './catalog.service.js';

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

describe('CatalogService', () => {
  it('rejects deactivating a unit that still has active bookings', async () => {
    const unitId = '00000000-0000-0000-0000-000000000010';
    const prismaMock = {
      unit: {
        findFirst: vi.fn().mockResolvedValue({
          id: unitId,
          tenantId: mockTenant.id,
          code: 'PS-01',
          name: 'PlayStation Reguler #1',
          type: UnitType.REGULER,
          isActive: true,
        }),
        update: vi.fn(),
      },
      booking: {
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;

    const service = new CatalogService(prismaMock);

    await expect(
      service.updateUnit(mockTenant, unitId, { isActive: false }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects creating a schedule block that overlaps an active booking', async () => {
    const prismaMock = {
      booking: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'b-1',
            bookingCode: 'MHF-001',
            unitId: '00000000-0000-0000-0000-000000000010',
            startAt: new Date('2026-11-29T19:00:00+07:00'),
            endAt: new Date('2026-11-29T20:00:00+07:00'),
          },
        ]),
      },
      scheduleBlock: {
        create: vi.fn(),
      },
    } as unknown as PrismaService;

    const service = new CatalogService(prismaMock);

    await expect(
      service.createScheduleBlock(mockTenant, {
        unitId: null,
        startAt: '2026-11-29T18:00:00+07:00',
        endAt: '2026-11-29T21:00:00+07:00',
        reason: 'Turnamen Internal',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
