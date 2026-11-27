import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DayCategory,
  PrismaClient,
  UnitType,
} from '../src/generated/prisma/client.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const DEFAULT_UNITS: ReadonlyArray<{
  code: string;
  name: string;
  type: UnitType;
}> = [
  { code: 'PS-01', name: 'PlayStation Reguler #1', type: UnitType.REGULER },
  { code: 'PS-02', name: 'PlayStation Reguler #2', type: UnitType.REGULER },
  { code: 'PS-03', name: 'PlayStation Reguler #3', type: UnitType.REGULER },
  { code: 'PS-04', name: 'PlayStation Reguler #4', type: UnitType.REGULER },
  { code: 'VIP-01', name: 'PlayStation VIP #1', type: UnitType.VIP },
  { code: 'VIP-02', name: 'PlayStation VIP #2', type: UnitType.VIP },
];

const DEFAULT_RATE_RULES: ReadonlyArray<{
  unitType: UnitType;
  dayCategory: DayCategory;
  hourlyRate: number;
}> = [
  { unitType: UnitType.REGULER, dayCategory: DayCategory.WEEKDAY, hourlyRate: 10000 },
  { unitType: UnitType.REGULER, dayCategory: DayCategory.SUNDAY, hourlyRate: 12000 },
  { unitType: UnitType.VIP, dayCategory: DayCategory.WEEKDAY, hourlyRate: 20000 },
  { unitType: UnitType.VIP, dayCategory: DayCategory.SUNDAY, hourlyRate: 25000 },
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'mohef-playstation' },
    update: {
      name: 'Mohef PlayStation',
      bookingMode: 'hourly_unit',
      openTime: '10:00',
      closeTime: '23:00',
      dpHoldMinutes: 10,
      gracePeriodMinutes: 15,
      maxGraceExtensionMinutes: 15,
    },
    create: {
      name: 'Mohef PlayStation',
      slug: 'mohef-playstation',
      bookingMode: 'hourly_unit',
      openTime: '10:00',
      closeTime: '23:00',
      dpHoldMinutes: 10,
      gracePeriodMinutes: 15,
      maxGraceExtensionMinutes: 15,
    },
  });

  for (const unit of DEFAULT_UNITS) {
    await prisma.unit.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: unit.code,
        },
      },
      update: {
        name: unit.name,
        type: unit.type,
        isActive: true,
      },
      create: {
        tenantId: tenant.id,
        code: unit.code,
        name: unit.name,
        type: unit.type,
        isActive: true,
      },
    });
  }

  for (const rule of DEFAULT_RATE_RULES) {
    await prisma.rateRule.upsert({
      where: {
        tenantId_unitType_dayCategory: {
          tenantId: tenant.id,
          unitType: rule.unitType,
          dayCategory: rule.dayCategory,
        },
      },
      update: {
        hourlyRate: rule.hourlyRate,
      },
      create: {
        tenantId: tenant.id,
        unitType: rule.unitType,
        dayCategory: rule.dayCategory,
        hourlyRate: rule.hourlyRate,
      },
    });
  }

  console.log(
    `Seeded tenant "${tenant.name}" (${DEFAULT_UNITS.length} units, ${DEFAULT_RATE_RULES.length} rate rules).`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
