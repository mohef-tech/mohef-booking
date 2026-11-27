import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ClockService } from '../src/common/clock.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Bookings & Payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdBookingIds: string[] = [];

  // Fixed Sunday 2030-01-06 14:10 WIB inside operating hours 10:00-23:00 (isolated from manual data)
  const fixedNow = new Date('2030-01-06T14:10:00+07:00');
  const testDayStart = new Date('2030-01-06T00:00:00+07:00');
  const testDayEnd = new Date('2030-01-07T00:00:00+07:00');

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClockService)
      .useValue({ now: () => fixedNow })
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
    await prisma.booking.deleteMany({
      where: {
        startAt: { gte: testDayStart, lt: testDayEnd },
      },
    });
  });

  afterEach(async () => {
    if (createdBookingIds.length > 0) {
      await prisma.booking.deleteMany({
        where: { id: { in: [...createdBookingIds] } },
      });
      createdBookingIds.length = 0;
    }
    await app.close();
  });

  it('creates online booking (specific & auto unit), prevents 409 conflict, and verifies DP', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .query({ type: 'VIP' })
      .expect(200);
    const vip1 = unitsRes.body.find(
      (u: { code: string }) => u.code === 'VIP-01',
    ) as { id: string; code: string };

    // 1. Specific unit online booking on Sunday VIP-01 19:00-20:00 (Rp 25.000, DP 12.500)
    const online1 = await request(app.getHttpServer())
      .post('/api/bookings/online')
      .send({
        date: '2030-01-06',
        startTime: '19:00',
        durationMinutes: 60,
        unitId: vip1.id,
        customerName: 'Andi',
        customerWhatsapp: '08120000001',
        paymentMethod: 'QRIS',
      })
      .expect(201);
    createdBookingIds.push(online1.body.id);

    expect(online1.body).toMatchObject({
      status: 'HOLD_DP',
      paymentStatus: 'UNPAID',
      totalAmount: 25000,
      dpAmount: 12500,
      remainingAmount: 25000,
      unitId: vip1.id,
    });
    expect(online1.body.bookingCode).toMatch(/^MHF-[A-Z2-9]{6}$/);

    // 2. Overlapping booking on same VIP-01 must fail with 409 Conflict
    await request(app.getHttpServer())
      .post('/api/bookings/online')
      .send({
        date: '2030-01-06',
        startTime: '19:30',
        durationMinutes: 60,
        unitId: vip1.id,
        customerName: 'Bentrok',
        customerWhatsapp: '08120000002',
        paymentMethod: 'VA',
      })
      .expect(409);

    // 3. Auto-allocated VIP booking on same slot should pick VIP-02
    const onlineAuto = await request(app.getHttpServer())
      .post('/api/bookings/online')
      .send({
        date: '2030-01-06',
        startTime: '19:00',
        durationMinutes: 60,
        unitType: 'VIP',
        customerName: 'Citra',
        customerWhatsapp: '08120000003',
        paymentMethod: 'VA',
      })
      .expect(201);
    createdBookingIds.push(onlineAuto.body.id);
    expect(onlineAuto.body.unit.code).toBe('VIP-02');

    // 4. Verify DP before expiresAt -> CONFIRMED & DP_PAID
    const verifyRes = await request(app.getHttpServer())
      .post('/api/payments/simulate/verify')
      .send({ bookingCode: online1.body.bookingCode })
      .expect(200);

    expect(verifyRes.body).toMatchObject({
      outcome: 'CONFIRMED',
      booking: {
        status: 'CONFIRMED',
        paymentStatus: 'DP_PAID',
        paidAmount: 12500,
        remainingAmount: 12500,
      },
    });

    // 5. Public status lookup and daily listing
    const publicRes = await request(app.getHttpServer())
      .get(`/api/bookings/public/${online1.body.bookingCode}`)
      .expect(200);
    expect(publicRes.body.payments[0].status).toBe('VERIFIED');
    expect(publicRes.body.logs.length).toBeGreaterThanOrEqual(2);

    const listRes = await request(app.getHttpServer())
      .get('/api/bookings')
      .query({ date: '2030-01-06' })
      .expect(200);
    expect(listRes.body.length).toBeGreaterThanOrEqual(2);
  });

  it('handles walk-in direct full payment and rejects future walk-in slot', async () => {
    // Future slot rejected
    await request(app.getHttpServer())
      .post('/api/bookings/walk-in')
      .send({
        date: '2030-01-06',
        startTime: '17:00',
        durationMinutes: 60,
        unitType: 'REGULER',
        paymentMethod: 'CASH',
      })
      .expect(400);

    // Current running slot (14:00 WIB for fixedNow 14:10 WIB) succeeds
    const walkInRes = await request(app.getHttpServer())
      .post('/api/bookings/walk-in')
      .send({
        date: '2030-01-06',
        startTime: '14:00',
        durationMinutes: 60,
        unitType: 'REGULER',
        paymentMethod: 'CASH',
      })
      .expect(201);
    createdBookingIds.push(walkInRes.body.id);

    expect(walkInRes.body).toMatchObject({
      source: 'WALK_IN',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      totalAmount: 12000,
      paidAmount: 12000,
      remainingAmount: 0,
    });
    expect(walkInRes.body.payments[0]).toMatchObject({
      type: 'DIRECT_FULL',
      method: 'CASH',
      status: 'VERIFIED',
    });
  });

  it('handles chat booking (DP & DIRECT_FULL) and late payment CONFLICT_ADMIN scenario', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .query({ type: 'REGULER' })
      .expect(200);
    const ps1 = unitsRes.body.find(
      (u: { code: string }) => u.code === 'PS-01',
    ) as { id: string };

    // 1. Customer A creates online booking on PS-01 20:00-21:00 (HOLD_DP)
    const bookingA = await request(app.getHttpServer())
      .post('/api/bookings/online')
      .send({
        date: '2030-01-06',
        startTime: '20:00',
        durationMinutes: 60,
        unitId: ps1.id,
        customerName: 'Telat Bayar',
        customerWhatsapp: '08120000010',
        paymentMethod: 'QRIS',
      })
      .expect(201);
    createdBookingIds.push(bookingA.body.id);

    // 2. Force expire Customer A hold -> releases PS-01 20:00-21:00
    const expireRes = await request(app.getHttpServer())
      .post('/api/payments/simulate/expire')
      .send({ bookingCode: bookingA.body.bookingCode })
      .expect(200);
    expect(expireRes.body.booking.status).toBe('EXPIRED');

    // 3. Cashier creates Chat booking for Customer B on the now-free PS-01 20:00-21:00
    const bookingB = await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .send({
        date: '2030-01-06',
        startTime: '20:00',
        durationMinutes: 60,
        unitId: ps1.id,
        customerName: 'Pelanggan Chat',
        customerWhatsapp: '08120000011',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);
    createdBookingIds.push(bookingB.body.id);
    expect(bookingB.body).toMatchObject({
      source: 'CHAT',
      status: 'CONFIRMED',
      paymentStatus: 'DP_PAID',
      paidAmount: 6000,
      remainingAmount: 6000,
    });

    // 4. Customer A's late DP payment arrives -> Payment VERIFIED, Booking CONFLICT_ADMIN, Booking B untouched!
    const conflictRes = await request(app.getHttpServer())
      .post('/api/payments/simulate/verify')
      .send({ bookingCode: bookingA.body.bookingCode })
      .expect(200);

    expect(conflictRes.body).toMatchObject({
      outcome: 'CONFLICT_ADMIN',
      booking: {
        status: 'CONFLICT_ADMIN',
        paymentStatus: 'DP_PAID',
      },
    });
    expect(conflictRes.body.booking.payments[0].status).toBe('VERIFIED');
    expect(
      conflictRes.body.booking.logs.some(
        (l: { action: string }) => l.action === 'PAYMENT_CONFLICT_ADMIN',
      ),
    ).toBe(true);

    // Confirm Booking B is still CONFIRMED and untouched
    const checkB = await request(app.getHttpServer())
      .get(`/api/bookings/public/${bookingB.body.bookingCode}`)
      .expect(200);
    expect(checkB.body.status).toBe('CONFIRMED');
  });
});
