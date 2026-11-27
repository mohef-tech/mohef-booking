# mohef-booking

Sistem manajemen reservasi dan operasional lantai usaha (V1: Rental PlayStation) dengan arsitektur **Decoupled Monorepo** (API-First) yang siap dikembangkan menjadi multi-tenant pada V2.

## Arsitektur Decoupled Monorepo

- `backend/`: NestJS (TypeScript) + PostgreSQL, menangani REST API, aturan bisnis kalender grid 30 menit, background worker (`@nestjs/schedule`), dan pembaruan real-time (SSE).
- `frontend/`: Next.js (TypeScript), menyediakan halaman publik status booking pelanggan, kalender operasional kasir, dan panel admin.
- Komunikasi antara `frontend/` dan `backend/` hanya melalui kontrak REST API.

## Menjalankan Database (Docker Compose)

PostgreSQL 16 berjalan pada port host `5433` (memetakan ke `5432` kontainer) agar tidak bentrok dengan port `5432` milik `mohef-pos`, dengan data persisten di `.docker/postgres-data/` dan aktivasi otomatis ekstensi `btree_gist` (untuk constraint `EXCLUDE USING GIST` + `tstzrange`).

1. (Opsional) Salin file konfigurasi lingkungan:
   ```bash
   cp .env.example .env
   ```
2. Jalankan service PostgreSQL:
   ```bash
   docker compose up -d
   ```
3. Periksa status dan healthcheck kontainer:
   ```bash
   docker compose ps
   ```

Default kredensial lokal (sesuai `.env.example`):
- Host: `localhost`
- Port: `5433`
- Database: `mohef_booking_db`
- User: `booking_admin`
- Password: `booking123`

## Struktur Folder `docs/`

- `docs/PRD_v0.2.md`: Source of truth spesifikasi produk V1, aturan bisnis, state machine booking, dan fondasi multi-tenant V2.
- `docs/DESIGN_DIRECTION.md`: Arah visual dan sistem desain antarmuka (dibuat sebelum pengembangan UI frontend).
- `docs/PROGRESS.md`: Log progres penyelesaian setiap langkah pengembangan.
