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
