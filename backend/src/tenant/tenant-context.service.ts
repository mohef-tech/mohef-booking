import { Injectable, NotFoundException } from '@nestjs/common';
import type { Tenant } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const DEFAULT_TENANT_SLUG = 'mohef-playstation';

@Injectable()
export class TenantContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(slugHeader?: string | string[]): Promise<Tenant> {
    const raw = Array.isArray(slugHeader) ? slugHeader[0] : slugHeader;
    const normalized = raw?.trim().toLowerCase();
    const slug = normalized && normalized.length > 0 ? normalized : DEFAULT_TENANT_SLUG;

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant dengan slug "${slug}" tidak ditemukan`);
    }

    return tenant;
  }
}
