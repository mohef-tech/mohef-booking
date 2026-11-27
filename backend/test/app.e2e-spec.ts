import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

describe('Backend API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  it('GET /api/health returns database connected', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      database: 'connected',
    });
  });

  it('GET /api/settings resolves default tenant and rejects unknown slug', async () => {
    const okRes = await request(app.getHttpServer())
      .get('/api/settings')
      .expect(200);

    expect(okRes.body).toMatchObject({
      slug: 'mohef-playstation',
      openTime: '10:00',
      closeTime: '23:00',
    });

    await request(app.getHttpServer())
      .get('/api/settings')
      .set('x-tenant-slug', 'tidak-ada')
      .expect(404);
  });

  it('GET /api/units and /api/rate-rules return seeded master data', async () => {
    const unitsRes = await request(app.getHttpServer())
      .get('/api/units')
      .expect(200);
    expect(unitsRes.body).toHaveLength(6);

    const ratesRes = await request(app.getHttpServer())
      .get('/api/rate-rules')
      .expect(200);
    expect(ratesRes.body).toHaveLength(4);
  });

  it('GET /api/availability/calendar and /check validate grid & Sunday pricing', async () => {
    const calRes = await request(app.getHttpServer())
      .get('/api/availability/calendar')
      .query({ date: '2026-11-29' })
      .expect(200);

    expect(calRes.body).toMatchObject({
      date: '2026-11-29',
      timezone: 'Asia/Jakarta',
      dayCategory: 'SUNDAY',
    });
    expect(calRes.body.units).toHaveLength(6);

    const checkRes = await request(app.getHttpServer())
      .get('/api/availability/check')
      .query({
        date: '2026-11-29',
        startTime: '19:00',
        durationMinutes: 60,
        unitType: 'VIP',
      })
      .expect(200);

    expect(checkRes.body).toMatchObject({
      available: true,
      endTime: '20:00',
      pricing: {
        dayCategory: 'SUNDAY',
        hourlyRate: 25000,
        totalAmount: 25000,
        dpAmount: 12500,
        remainingAmount: 12500,
      },
    });

    await request(app.getHttpServer())
      .get('/api/availability/check')
      .query({
        date: '2026-11-29',
        startTime: '19:15',
        durationMinutes: 60,
        unitType: 'REGULER',
      })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
