import { NotFoundException } from '@nestjs/common';
import type { Tenant } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  DEFAULT_TENANT_SLUG,
  TenantContextService,
} from './tenant-context.service.js';

const mockTenant: Tenant = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Mohef PlayStation',
  slug: DEFAULT_TENANT_SLUG,
  bookingMode: 'hourly_unit',
  openTime: '10:00',
  closeTime: '23:00',
  dpHoldMinutes: 10,
  gracePeriodMinutes: 15,
  maxGraceExtensionMinutes: 15,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TenantContextService', () => {
  it('falls back to default tenant slug when header is omitted', async () => {
    const findUnique = vi.fn().mockResolvedValue(mockTenant);
    const service = new TenantContextService({
      tenant: { findUnique },
    } as unknown as PrismaService);

    const tenant = await service.resolve(undefined);

    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: DEFAULT_TENANT_SLUG },
    });
    expect(tenant.slug).toBe(DEFAULT_TENANT_SLUG);
  });

  it('throws NotFoundException when slug does not exist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const service = new TenantContextService({
      tenant: { findUnique },
    } as unknown as PrismaService);

    await expect(service.resolve('unknown-tenant')).rejects.toThrow(
      NotFoundException,
    );
  });
});
