import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ClockService } from '../src/common/clock.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Booking Operations & Admin Resolution (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdBookingIds: string[] = [];

  // Isolated test dates: Sunday 2030-02-03 & Monday 2030-02-04
  let currentNow = new Date('2030-02-03T14:10:00+07:00');
  const testWindowStart = new Date('2030-02-03T00:00:00+07:00');
  const testWindowEnd = new Date('2030-02-05T00:00:00+07:00');

  beforeEach(async () => {
    currentNow = new Date('2030-02-03T14:10:00+07:00');

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
    await prisma.booking.deleteMany({
      where: {
        startAt: { gte: testWindowStart, lt: testWindowEnd },
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

  it('runs check-in, start-play (pegang stik), extend-duration, move-unit, and complete', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .query({ type: 'REGULER' })
      .expect(200);
    const ps1 = unitsRes.body.find((u: { code: string }) => u.code === 'PS-01');
    const ps2 = unitsRes.body.find((u: { code: string }) => u.code === 'PS-02');

    // Create chat booking DP 50% for PS-01 15:00-16:00 Sunday (Rp 12.000, DP 6.000)
    const bookingRes = await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .send({
        date: '2030-02-03',
        startTime: '15:00',
        durationMinutes: 60,
        unitId: ps1.id,
        customerName: 'Raka',
        customerWhatsapp: '08123456700',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);
    createdBookingIds.push(bookingRes.body.id);

    // Move clock to 15:04 (inside 15:15 deadline) -> check-in settles 50%
    currentNow = new Date('2030-02-03T15:04:00+07:00');
    const checkInRes = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingRes.body.id}/check-in`)
      .send({ paymentMethod: 'CASH' })
      .expect(200);
    expect(checkInRes.body).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAmount: 12000,
      remainingAmount: 0,
    });

    // Start play at 15:04 without next booking -> endAt becomes 16:04
    const startPlayRes = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingRes.body.id}/start-play`)
      .expect(200);
    expect(startPlayRes.body.status).toBe('PLAYING');
    expect(startPlayRes.body.endAt).toBe('2030-02-03T09:04:00.000Z'); // 16:04 WIB

    // Extend duration +30 minutes -> Rp 6.000, endAt becomes 16:34 WIB
    const extendRes = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingRes.body.id}/extend-duration`)
      .send({ extraMinutes: 30, paymentMethod: 'QRIS' })
      .expect(200);
    expect(extendRes.body).toMatchObject({
      totalAmount: 18000,
      paidAmount: 18000,
      endAt: '2030-02-03T09:34:00.000Z',
    });

    // Move unit from PS-01 to PS-02 (same REGULER type)
    const moveRes = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingRes.body.id}/move-unit`)
      .send({ targetUnitId: ps2.id })
      .expect(200);
    expect(moveRes.body.unit.code).toBe('PS-02');

    // Complete session
    const completeRes = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingRes.body.id}/complete`)
      .expect(200);
    expect(completeRes.body.status).toBe('COMPLETED');
  });

  it('keeps calendar endAt on start-play when next booking exists on the same unit', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .query({ type: 'VIP' })
      .expect(200);
    const vip1 = unitsRes.body.find((u: { code: string }) => u.code === 'VIP-01');

    const b1 = await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .send({
        date: '2030-02-03',
        startTime: '18:00',
        durationMinutes: 60,
        unitId: vip1.id,
        customerName: 'Pertama',
        customerWhatsapp: '08120001',
        paymentType: 'DIRECT_FULL',
        paymentMethod: 'CASH',
      })
      .expect(201);
    createdBookingIds.push(b1.body.id);

    const b2 = await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .send({
        date: '2030-02-03',
        startTime: '19:00',
        durationMinutes: 60,
        unitId: vip1.id,
        customerName: 'Kedua',
        customerWhatsapp: '08120002',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);
    createdBookingIds.push(b2.body.id);

    currentNow = new Date('2030-02-03T18:05:00+07:00');
    const playRes = await request(app.getHttpServer())
      .post(`/api/bookings/${b1.body.id}/start-play`)
      .expect(200);

    expect(playRes.body.status).toBe('PLAYING');
    expect(playRes.body.endAt).toBe('2030-02-03T12:00:00.000Z'); // remains 19:00 WIB
  });

  it('enforces grace extension rules and H-1h reschedule with Weekday/Sunday rate diff', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .query({ type: 'REGULER' })
      .expect(200);
    const ps3 = unitsRes.body.find((u: { code: string }) => u.code === 'PS-03');

    // 30-min booking cannot extend grace (19:00-19:30)
    const shortBooking = await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .send({
        date: '2030-02-03',
        startTime: '19:00',
        durationMinutes: 30,
        unitId: ps3.id,
        customerName: 'Short',
        customerWhatsapp: '08120003',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);
    createdBookingIds.push(shortBooking.body.id);

    currentNow = new Date('2030-02-03T19:10:00+07:00');
    await request(app.getHttpServer())
      .post(`/api/bookings/${shortBooking.body.id}/extend-grace`)
      .send({ extraMinutes: 5 })
      .expect(400);

    // 60-min booking on Monday (Weekday Rp 10.000) reschedules >= 1h before to Sunday (Rp 12.000)
    currentNow = new Date('2030-02-03T14:10:00+07:00');
    const reschedBooking = await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .send({
        date: '2030-02-04', // Monday
        startTime: '19:00',
        durationMinutes: 60,
        unitId: ps3.id,
        customerName: 'Resched',
        customerWhatsapp: '08120004',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);
    createdBookingIds.push(reschedBooking.body.id);
    expect(reschedBooking.body.totalAmount).toBe(10000);
    expect(reschedBooking.body.paidAmount).toBe(5000);

    const reschedRes = await request(app.getHttpServer())
      .post(`/api/bookings/${reschedBooking.body.id}/reschedule`)
      .send({ date: '2030-02-03', startTime: '20:00' })
      .expect(200);
    expect(reschedRes.body).toMatchObject({
      rescheduleCount: 1,
      totalAmount: 12000,
      paidAmount: 5000,
      remainingAmount: 7000,
    });
  });

  it('resolves CONFLICT_ADMIN via REASSIGN and supports admin-cancel with REFUND', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .query({ type: 'VIP' })
      .expect(200);
    const vip1 = unitsRes.body.find((u: { code: string }) => u.code === 'VIP-01');
    const vip2 = unitsRes.body.find((u: { code: string }) => u.code === 'VIP-02');

    // Create online booking A -> expire -> booking B takes VIP-01 21:00 -> late verify A -> CONFLICT_ADMIN
    const a = await request(app.getHttpServer())
      .post('/api/bookings/online')
      .send({
        date: '2030-02-03',
        startTime: '21:00',
        durationMinutes: 60,
        unitId: vip1.id,
        customerName: 'Konflik',
        customerWhatsapp: '08120005',
        paymentMethod: 'QRIS',
      })
      .expect(201);
    createdBookingIds.push(a.body.id);

    await request(app.getHttpServer())
      .post('/api/payments/simulate/expire')
      .send({ bookingCode: a.body.bookingCode })
      .expect(200);

    const b = await request(app.getHttpServer())
      .post('/api/bookings/chat')
      .send({
        date: '2030-02-03',
        startTime: '21:00',
        durationMinutes: 60,
        unitId: vip1.id,
        customerName: 'Pengisi',
        customerWhatsapp: '08120006',
        paymentType: 'DP',
        paymentMethod: 'CASH',
      })
      .expect(201);
    createdBookingIds.push(b.body.id);

    await request(app.getHttpServer())
      .post('/api/payments/simulate/verify')
      .send({ bookingCode: a.body.bookingCode })
      .expect(200);

    // Admin reassigns conflicted booking A to VIP-02 21:00
    const reassignRes = await request(app.getHttpServer())
      .post(`/api/bookings/${a.body.id}/resolve-conflict`)
      .send({
        action: 'REASSIGN',
        unitId: vip2.id,
        date: '2030-02-03',
        startTime: '21:00',
      })
      .expect(200);
    expect(reassignRes.body).toMatchObject({
      status: 'CONFIRMED',
      unitId: vip2.id,
    });

    // Admin cancels booking B with full refund of paidAmount
    const cancelRes = await request(app.getHttpServer())
      .post(`/api/bookings/${b.body.id}/admin-cancel`)
      .send({ reason: 'Maintenance mendadak' })
      .expect(200);
    expect(cancelRes.body.status).toBe('CANCELLED');
    expect(
      cancelRes.body.payments.some(
        (p: { type: string; amount: number; status: string }) =>
          p.type === 'REFUND' && p.amount === 12500 && p.status === 'REFUNDED',
      ),
    ).toBe(true);
  });
});
