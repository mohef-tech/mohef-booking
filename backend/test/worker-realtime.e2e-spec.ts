import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import http from 'node:http';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ClockService } from '../src/common/clock.service.js';
import { DayCategory, UnitType } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

interface ParsedSseChunk {
  event: string;
  data: Record<string, unknown>;
}

const TEST_TENANT_SLUG = 'e2e-worker-tenant';

describe('Worker Automation & SSE Realtime (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let testTenantId: string;

  // Isolated Sunday 2030-03-03
  let currentNow = new Date('2030-03-03T14:10:00+07:00');

  beforeEach(async () => {
    currentNow = new Date('2030-03-03T14:10:00+07:00');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClockService)
      .useValue({ now: () => currentNow })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.tenant.deleteMany({
      where: { slug: TEST_TENANT_SLUG },
    });

    const tenant = await prisma.tenant.create({
      data: {
        name: 'E2E Worker Tenant',
        slug: TEST_TENANT_SLUG,
        units: {
          create: [
            { code: 'PS-01', name: 'PS #1', type: UnitType.REGULER },
            { code: 'PS-02', name: 'PS #2', type: UnitType.REGULER },
            { code: 'PS-03', name: 'PS #3', type: UnitType.REGULER },
            { code: 'PS-04', name: 'PS #4', type: UnitType.REGULER },
            { code: 'VIP-01', name: 'VIP #1', type: UnitType.VIP },
          ],
        },
        rateRules: {
          create: [
            {
              unitType: UnitType.REGULER,
              dayCategory: DayCategory.WEEKDAY,
              hourlyRate: 10000,
            },
            {
              unitType: UnitType.REGULER,
              dayCategory: DayCategory.SUNDAY,
              hourlyRate: 12000,
            },
            {
              unitType: UnitType.VIP,
              dayCategory: DayCategory.WEEKDAY,
              hourlyRate: 20000,
            },
            {
              unitType: UnitType.VIP,
              dayCategory: DayCategory.SUNDAY,
              hourlyRate: 25000,
            },
          ],
        },
      },
    });
    testTenantId = tenant.id;
  });

  afterEach(async () => {
    await prisma.booking.deleteMany({
      where: { tenantId: testTenantId },
    });
    await prisma.tenant.deleteMany({
      where: { id: testTenantId },
    });
    const server = app.getHttpServer() as unknown as {
      closeAllConnections?: () => void;
    };
    server.closeAllConnections?.();
    await app.close();
  });

  it('PRD AC: direct walk-in stays intact, grace-extended check-in works, and DP hold expiry releases slot', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .query({ type: 'REGULER' })
      .expect(200);
    const ps1 = unitsRes.body.find((u: { code: string }) => u.code === 'PS-01');
    const ps2 = unitsRes.body.find((u: { code: string }) => u.code === 'PS-02');

    // 1. Direct walk-in at 14:20 WIB (slot floor 14:00, deadline 14:15) must NOT become NO_SHOW on sweep
    currentNow = new Date('2030-03-03T14:20:00+07:00');
    const walkIn = await request(app.getHttpServer())
      .post('/api/bookings/walk-in')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({
        unitId: ps1.id,
        durationMinutes: 60,
        paymentMethod: 'CASH',
      })
      .expect(201);

    // 2. Booking 19:00-20:00 extended grace to 19:25 -> check-in at 19:21 works and survives sweep at 19:21
    const confirmedBooking = await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({
        date: '2030-03-03',
        startTime: '19:00',
        durationMinutes: 60,
        unitId: ps2.id,
        customerName: 'Telat Konfirmasi',
        customerWhatsapp: '08120001',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);

    currentNow = new Date('2030-03-03T19:10:00+07:00');
    await request(app.getHttpServer())
      .post(`/api/bookings/${confirmedBooking.body.id}/extend-grace`)
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({ extraMinutes: 10 })
      .expect(200);

    // 3. Online HOLD_DP created at 19:10 (expires 19:20) on PS-01 21:00-22:00
    const holdBooking = await request(app.getHttpServer())
      .post('/api/bookings/online')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({
        date: '2030-03-03',
        startTime: '21:00',
        durationMinutes: 60,
        unitId: ps1.id,
        customerName: 'Hold Expired',
        customerWhatsapp: '08120002',
        paymentMethod: 'QRIS',
      })
      .expect(201);

    // Sweep at 19:21 for test tenant -> holdBooking expires & becomes CANCELLED; walkIn & grace-extended confirmedBooking remain CONFIRMED
    const sweepRes = await request(app.getHttpServer())
      .post('/api/worker/sweep')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({ now: '2030-03-03T19:21:00+07:00' })
      .expect(200);
    expect(sweepRes.body).toMatchObject({
      expiredHoldCount: 1,
      noShowCount: 0,
    });

    const walkInStatus = await request(app.getHttpServer())
      .get(`/api/bookings/public/${walkIn.body.bookingCode}`)
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .expect(200);
    expect(walkInStatus.body.status).toBe('CONFIRMED');

    const holdStatus = await request(app.getHttpServer())
      .get(`/api/bookings/public/${holdBooking.body.bookingCode}`)
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .expect(200);
    expect(holdStatus.body.status).toBe('CANCELLED');
    expect(holdStatus.body.payments[0].status).toBe('EXPIRED');

    // Customer arrives at 19:21 (< 19:25) and checks in + plays
    currentNow = new Date('2030-03-03T19:21:00+07:00');
    await request(app.getHttpServer())
      .post(`/api/bookings/${confirmedBooking.body.id}/check-in`)
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({ paymentMethod: 'CASH' })
      .expect(200);

    const playRes = await request(app.getHttpServer())
      .post(`/api/bookings/${confirmedBooking.body.id}/start-play`)
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .expect(200);
    expect(playRes.body.status).toBe('PLAYING');

    // Released 21:00-22:00 slot on PS-01 is available again
    const checkReleased = await request(app.getHttpServer())
      .get('/api/availability/check')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .query({
        date: '2030-03-03',
        startTime: '21:00',
        durationMinutes: 60,
        unitId: ps1.id,
      })
      .expect(200);
    expect(checkReleased.body.available).toBe(true);
  });

  it('PRD AC: no-show with >= 30m reopens slot, while < 30m stays unavailable for new session', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .query({ type: 'REGULER' })
      .expect(200);
    const ps3 = unitsRes.body.find((u: { code: string }) => u.code === 'PS-03');
    const ps4 = unitsRes.body.find((u: { code: string }) => u.code === 'PS-04');

    // PS-03: 19:00-20:00 (deadline 19:15 -> remaining 45m >= 30m)
    await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({
        date: '2030-03-03',
        startTime: '19:00',
        durationMinutes: 60,
        unitId: ps3.id,
        customerName: 'NoShow Reopen',
        customerWhatsapp: '08120003',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);

    // PS-04: 19:00-19:30 (deadline 19:15 -> remaining 15m < 30m)
    await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({
        date: '2030-03-03',
        startTime: '19:00',
        durationMinutes: 30,
        unitId: ps4.id,
        customerName: 'NoShow Short',
        customerWhatsapp: '08120004',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);

    // Sweep at 19:16 WIB
    const sweepRes = await request(app.getHttpServer())
      .post('/api/worker/sweep')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .send({ now: '2030-03-03T19:16:00+07:00' })
      .expect(200);

    expect(sweepRes.body).toMatchObject({
      noShowCount: 2,
      reopenedSlotCount: 1,
      blockedShortRemainderCount: 1,
    });

    // PS-03 19:30-20:00 is reopened and available
    const availPs3 = await request(app.getHttpServer())
      .get('/api/availability/check')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .query({
        date: '2030-03-03',
        startTime: '19:30',
        durationMinutes: 30,
        unitId: ps3.id,
      })
      .expect(200);
    expect(availPs3.body.available).toBe(true);

    // PS-04 19:00-19:30 remainder (< 30m) is blocked and NOT available
    const availPs4 = await request(app.getHttpServer())
      .get('/api/availability/check')
      .set('x-tenant-slug', TEST_TENANT_SLUG)
      .query({
        date: '2030-03-03',
        startTime: '19:00',
        durationMinutes: 30,
        unitId: ps4.id,
      })
      .expect(200);
    expect(availPs4.body.available).toBe(false);
  });

  it('streams real-time SSE events on GET /api/events/stream for booking, verify, and sweep', async () => {
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Unexpected HTTP server address');
    }

    const receivedEvents: ParsedSseChunk[] = [];
    let connectedHandshakeSeen = false;
    let resCleanup: (() => void) | undefined;

    const streamReady = new Promise<void>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${address.port}/api/events/stream?tenantSlug=${TEST_TENANT_SLUG}`,
        (res) => {
          res.setEncoding('utf8');
          let buffer = '';

          res.on('data', (chunk: string) => {
            buffer += chunk;
            if (buffer.includes(': connected') && !connectedHandshakeSeen) {
              connectedHandshakeSeen = true;
              resolve();
            }

            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';

            for (const frame of frames) {
              const lines = frame.split('\n');
              let eventName = '';
              const dataLines: string[] = [];
              for (const line of lines) {
                if (line.startsWith('event:')) {
                  eventName = line.slice('event:'.length).trim();
                } else if (line.startsWith('data:')) {
                  dataLines.push(line.slice('data:'.length).trim());
                }
              }
              if (eventName && dataLines.length > 0) {
                receivedEvents.push({
                  event: eventName,
                  data: JSON.parse(dataLines.join('\n')) as Record<
                    string,
                    unknown
                  >,
                });
              }
            }
          });

          res.on('error', reject);
          resCleanup = () => {
            res.destroy();
            req.destroy();
          };
        },
      );

      req.on('error', reject);
    });

    try {
      await streamReady;

      // 1. Trigger BOOKING_CREATED
      const created = await request(app.getHttpServer())
        .post('/api/bookings/online')
        .set('x-tenant-slug', TEST_TENANT_SLUG)
        .send({
          date: '2030-03-03',
          startTime: '22:00',
          durationMinutes: 60,
          unitType: 'VIP',
          customerName: 'SSE Tester',
          customerWhatsapp: '08120005',
          paymentMethod: 'QRIS',
        })
        .expect(201);

      // 2. Trigger DP_VERIFIED
      await request(app.getHttpServer())
        .post('/api/payments/simulate/verify')
        .set('x-tenant-slug', TEST_TENANT_SLUG)
        .send({ bookingCode: created.body.bookingCode })
        .expect(200);

      // 3. Trigger SLOT_RELEASED_NO_SHOW via sweep past 22:15
      await request(app.getHttpServer())
        .post('/api/worker/sweep')
        .set('x-tenant-slug', TEST_TENANT_SLUG)
        .send({ now: '2030-03-03T22:16:00+07:00' })
        .expect(200);

      await new Promise((r) => setTimeout(r, 150));

      const eventNames = receivedEvents.map((e) => e.event);
      expect(eventNames).toContain('BOOKING_CREATED');
      expect(eventNames).toContain('DP_VERIFIED');
      expect(eventNames).toContain('SLOT_RELEASED_NO_SHOW');
      expect(
        receivedEvents.every(
          (e) =>
            e.data['tenantId'] === testTenantId &&
            e.data['bookingCode'] === created.body.bookingCode,
        ),
      ).toBe(true);
    } finally {
      resCleanup?.();
    }
  });
});
