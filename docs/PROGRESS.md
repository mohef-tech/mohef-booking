# Progres Pengembangan - `mohef-booking`

## Langkah 1: Fondasi Infrastruktur & Docker
- **Status:** Selesai (2026-11-27)
- **Ringkasan Perubahan:**
  - Mengonfigurasi `.gitignore` di root (mengabaikan `.docker/postgres-data/`, `node_modules/`, `.next/`, `dist/`, `.env`, `.env.*` kecuali `.env.example`, log, serta `.DS_Store` dan `Thumbs.db`) dan menghapus `.docker/.gitkeep`.
  - Menyiapkan `docker-compose.yml` untuk service `postgres` (`postgres:16-alpine`), port `5433:5432`, volume persisten `./.docker/postgres-data:/var/lib/postgresql/data`, healthcheck `pg_isready`, serta skrip inisialisasi `.docker/init/01-extensions.sql` untuk mengaktifkan ekstensi `btree_gist`.
  - Membuat `.env.example` untuk konfigurasi PostgreSQL dan port aplikasi (`BACKEND_PORT`, `FRONTEND_PORT`).
  - Mengisi `README.md` berisi ringkasan arsitektur Decoupled Monorepo, panduan Docker Compose, dan struktur folder `docs/`.

## Langkah 2: Inisialisasi Backend NestJS
- **Status:** Selesai (2026-11-27)
- **Ringkasan Perubahan:**
  - Menghapus `backend/.gitkeep` dan menginisialisasi proyek NestJS 12 (ESM, TypeScript strict mode, `npm`) di `backend/`.
  - Memasang dependensi inti: `@nestjs/config`, `@nestjs/schedule`, `class-validator`, `class-transformer`, `prisma@^7.10.1`, `@prisma/client@^7.10.1`, `@prisma/adapter-pg@^7.10.1`, `pg`, `dotenv`, dan `@types/pg`.
  - Menginisialisasi Prisma dengan provider `postgresql` (`backend/prisma/schema.prisma`, `backend/prisma7.config.ts`) dengan output client di `backend/src/generated/prisma`, serta membuat `PrismaModule`/`PrismaService` global.
  - Membuat `backend/.env.example` dan `backend/.env` (`PORT=4000`, `DATABASE_URL` ke PostgreSQL Docker port `5433`, `CORS_ORIGIN=http://localhost:3000`).
  - Mengaktifkan global prefix `/api`, global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), CORS, shutdown hooks di `backend/src/main.ts`, mendaftarkan `ConfigModule` dan `ScheduleModule` di `backend/src/app.module.ts`, serta menambahkan endpoint `GET /api/health` dengan pengecekan koneksi database (`SELECT 1`).
  - Terverifikasi tanpa error melalui `npm run build`, `npm test`, dan `npm run test:e2e`.

## Langkah 3: Inisialisasi Frontend Next.js
- **Status:** Selesai (2026-11-27)
- **Ringkasan Perubahan:**
  - Menghapus `frontend/.gitkeep` dan menginisialisasi Next.js 16.4.6 (App Router, TypeScript strict, ESLint flat config, `src/`, tanpa Tailwind CSS, menggunakan Vanilla CSS tokens & CSS Modules) di `frontend/`.
  - Membuat `frontend/.env.example` dan `frontend/.env.local` berisi `NEXT_PUBLIC_API_URL=http://localhost:4000/api`.
  - Menyiapkan `frontend/src/lib/api.ts` (fetch wrapper + `ApiError` + `getHealthStatus`), kontrak DTO pada `frontend/src/types/` (`unit.ts`, `rate.ts`, `booking.ts`, `index.ts`) selaras PRD V1 dan kesiapan multi-tenant V2, token dasar di `frontend/src/app/globals.css`, serta placeholder rute minimal `/` (Portal Pelanggan), `/b/[code]` (Status Booking Publik), `/kasir` (Workspace Kasir), dan `/admin` (Workspace Admin).
  - Terverifikasi 0 warning dan 0 error melalui `npm run lint` dan `npm run build`.

## Tahap 2 - Langkah 1: Skema Database & Seed Data (`backend/`)
- **Status:** Selesai (2026-11-27)
- **Ringkasan Perubahan:**
  - Merancang skema Prisma multi-tenant di `backend/prisma/schema.prisma` (`Tenant`, `Unit`, `RateRule`, `Booking`, `Payment`, `BookingLog`, `ScheduleBlock`) lengkap dengan `tenant_id`, kolom `Timestamptz`, enum status/pembayaran/peran, serta indeks operasional.
  - Membuat dan menerapkan migrasi `20261127073308_init_schema` serta migrasi raw SQL `20261127073400_add_booking_exclusion_constraint` yang mengaktifkan `btree_gist`, check constraint `end_at > start_at`, dan partial exclusion constraint `EXCLUDE USING GIST (unit_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status IN ('HOLD_DP', 'CONFIRMED', 'PLAYING'))`.
  - Membuat script seed idempoten `backend/prisma/seed.ts` (terdaftar di `backend/prisma7.config.ts` dan `backend/package.json` `prisma:seed`) untuk 1 tenant default (`Mohef PlayStation`), 4 unit `REGULER` (`PS-01` s/d `PS-04`), 2 unit `VIP` (`VIP-01` s/d `VIP-02`), dan 4 matriks tarif (`REGULER` Weekday Rp 10.000/jam, Minggu Rp 12.000/jam; `VIP` Weekday Rp 20.000/jam, Minggu Rp 25.000/jam).
  - Terverifikasi tanpa error melalui `prisma migrate dev`, `prisma generate`, `npm run prisma:seed`, `npm run build`, `npm test`, `npm run test:e2e`, serta uji langsung constraint GiST di PostgreSQL.

## Tahap 2 - Langkah 2: Modul Master Data & Mesin Ketersediaan Slot (`backend/`)
- **Status:** Selesai (2026-11-27)
- **Ringkasan Perubahan:**
  - Membuat modul resolusi tenant global (`TenantModule`, `TenantContextService`, `@TenantSlug()`) yang membaca header opsional `x-tenant-slug` dengan fallback default `mohef-playstation` dan melempar `NotFoundException` jika slug tidak ditemukan.
  - Membuat modul Master Data `catalog` dengan endpoint `GET/PATCH /api/settings`, `GET/POST /api/units`, `PATCH /api/units/:id` (menolak nonaktif unit yang masih memiliki booking aktif `HOLD_DP`/`CONFIRMED`/`PLAYING`), `GET/PUT /api/rate-rules` (4 matriks tarif), serta `GET/POST /api/schedule-blocks` dan `DELETE /api/schedule-blocks/:id` (validasi anti-tabrakan dengan booking aktif untuk unit tertentu maupun seluruh tempat).
  - Membuat modul `availability` dengan endpoint `GET /api/availability/calendar` dan `GET /api/availability/check` (validasi grid kelipatan 30 menit, jam operasional WIB/`Asia/Jakarta`, deteksi otomatis `SUNDAY` vs `WEEKDAY`, filter unit bebas/spesifik terhadap booking aktif & schedule block, serta rincian harga total dan DP 50%/pelunasan 50%).
  - Menambahkan unit test terfokus (`time-slot.util.spec.ts`, `tenant-context.service.spec.ts`, `catalog.service.spec.ts`, `availability.service.spec.ts`) serta e2e test pada `test/app.e2e-spec.ts`; terverifikasi 0 error melalui `npm test`, `npm run test:e2e`, dan `npm run build`.

## Tahap 2 - Langkah 3: Modul Transaksi Booking & Simulasi Pembayaran (`backend/`)
- **Status:** Selesai (menunggu eksekusi verifikasi manual user, 2026-11-27)
- **Ringkasan Perubahan:**
  - Menambahkan pembangkit kode booking `MHF-XXXXXX` tanpa karakter ambigu (`0/O/1/I`) di `backend/src/common/booking-code.util.ts`, utilitas deteksi error PostgreSQL exclusion constraint `23P01` di `backend/src/common/prisma-error.util.ts`, `ClockModule`/`ClockService`, serta `buildJakartaBookingInterval` dan `getCurrentJakartaSlot` di `backend/src/common/time-slot.util.ts`.
  - Membuat modul `bookings` (`POST /api/bookings/online`, `POST /api/bookings/walk-in`, `POST /api/bookings/chat`, `GET /api/bookings/public/:bookingCode`, `GET /api/bookings?date=YYYY-MM-DD`) dengan transaksi atomik, alokasi unit spesifik/otomatis, validasi walk-in sesi berjalan lunas di muka, pemetaan `23P01` ke `ConflictException` (409), dan pencatatan `BookingLog`.
  - Membuat modul `payments` (`POST /api/payments/simulate/verify` dan `POST /api/payments/simulate/expire`) dengan penanganan verifikasi DP tepat waktu (`CONFIRMED` + `DP_PAID`) serta pembayaran terlambat pasca-hold kedaluwarsa saat slot sudah terisi (`Payment.status = VERIFIED`, `Booking.status = CONFLICT_ADMIN` tanpa menimpa jadwal aktif lain).
  - Menambahkan unit test (`booking-code.util.spec.ts`, `bookings.service.spec.ts`, `payments.service.spec.ts`) dan e2e test (`test/bookings-payments.e2e-spec.ts`) dengan isolasi tanggal uji (`2030-01-06`). Terverifikasi 0 error melalui `npm test`, `npm run test:e2e`, dan `npm run build`.

## Tahap 2 - Langkah 4: Operasional Lantai Kasir, Tenggang Check-in, Perubahan Jadwal, & Resolusi Admin (`backend/`)
- **Status:** Selesai (2026-11-27)
- **Ringkasan Perubahan:**
  - Menambahkan `getJakartaDateString` & `getJakartaClosingDateTime` di `backend/src/common/time-slot.util.ts` serta konstanta `BOOKING_DETAIL_INCLUDE` / `attachRemainingAmount` di `backend/src/bookings/booking.constants.ts`.
  - Membuat `BookingOperationsService` (`backend/src/bookings/booking-operations.service.ts`) dan 9 endpoint pada `BookingsController`:
    - Operasional lantai: `POST /api/bookings/:id/check-in` (validasi deadline & pelunasan sisa 50% `SETTLEMENT`), `POST /api/bookings/:id/start-play` ("Pegang Stik" dengan penyesuaian `endAt` penuh jika slot berikutnya kosong atau mempertahankan `endAt` kalender jika ada booking berikutnya), dan `POST /api/bookings/:id/complete`.
    - Kendali tenggang & jadwal: `POST /api/bookings/:id/extend-grace` (maksimal 1x, sebelum tenggang habis, sisa main efektif >= 15 menit), `POST /api/bookings/:id/reschedule` (maksimal 1x, >= 60 menit sebelum mulai, penyesuaian tarif Weekday/Minggu), `POST /api/bookings/:id/extend-duration` (kelipatan 30 menit + pembayaran langsung), dan `POST /api/bookings/:id/move-unit` (unit aktif setipe & kosong).
    - Resolusi admin: `POST /api/bookings/:id/resolve-conflict` (`REFUND` atau `REASSIGN`) dan `POST /api/bookings/:id/admin-cancel` (refund penuh `paidAmount`).
  - Menambahkan unit test (`booking-operations.service.spec.ts`), e2e test (`test/booking-operations.e2e-spec.ts` dengan isolasi tanggal `2030-02-03`/`2030-02-04`), dan `fileParallelism: false` di `backend/vitest.config.e2e.ts`. Terverifikasi 0 error melalui `npm test` (33 tests), `npm run test:e2e` (11 tests), dan `npm run build`.

## Tahap 2 - Langkah 5: Background Worker Otomatis & Notifikasi Real-Time SSE (`backend/`)
- **Status:** Selesai (2026-11-27)
- **Ringkasan Perubahan:**
  - Membuat modul `realtime` global (`RealtimeModule`, `RealtimeEventsService`, `RealtimeController`) dengan endpoint SSE `GET /api/events/stream` yang memancarkan stream event terstruktur (`BOOKING_CREATED`, `DP_VERIFIED`, `DP_EXPIRED`, `GRACE_EXTENDED`, `CHECKED_IN`, `PLAY_STARTED`, `SLOT_RELEASED_NO_SHOW`, `CONFLICT_ADMIN`, `BOOKING_UPDATED`) terisolasi per `tenantId`.
  - Menghubungkan pemancar event SSE ke seluruh perubahan status pada `BookingsService`, `BookingOperationsService`, `PaymentsService`, dan `BookingAutomationService`.
  - Membuat modul `worker` (`WorkerModule`, `BookingAutomationService` dengan `@Interval(15000)`, dan `WorkerController` `POST /api/worker/sweep`) untuk sweep atomik hold DP kedaluwarsa (`Payment.status = EXPIRED`, `Booking.status = CANCELLED`, event `DP_EXPIRED`) serta sweep no-show batas check-in (`Booking.status = NO_SHOW`, mempertahankan DP, membuka kembali slot sisa `>= 30 menit` atau memblokir sisa `< 30 menit` melalui `ScheduleBlock`, event `SLOT_RELEASED_NO_SHOW`).
  - Menambahkan unit test (`realtime-events.service.spec.ts`, `booking-automation.service.spec.ts`) serta e2e test (`test/worker-realtime.e2e-spec.ts`) untuk skenario penerimaan PRD dan stream SSE. Terverifikasi 0 error melalui `npm test`, `npm run test:e2e`, dan `npm run build`.
