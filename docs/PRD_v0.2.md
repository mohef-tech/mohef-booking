# Product Requirements Document (PRD) — `mohef-booking`

* **Versi Dokumen:** 0.2 (Final Fondasi Pengembangan V1)
* **Nama Proyek:** `mohef-booking`
* **Model Distribusi:** SaaS Multi-Tenant & Lisensi Jual Putus (Single-Tenant Deployment)
* **Domain V1:** Reservasi & Operasional Rental PlayStation

## 1. Tujuan & Visi Produk

`mohef-booking` adalah sistem manajemen reservasi dan operasional lantai usaha berbasis **Decoupled Architecture (API-First)**. Pada Versi 1, sistem dirancang untuk menyatukan pemesanan **Online**, **Chat**, dan **Walk-in** di usaha rental PlayStation ke dalam satu kalender anti-bentrok berbasis grid **30 menit**, sekaligus mengotomatiskan penahanan DP, tenggang kedatangan, pencatatan waktu main aktual (*pegang stik*), dan pelepasan slot sisa dari pelanggan yang tidak hadir.

Sejak fondasi V1, struktur data dan modul inti dirancang siap untuk dua model bisnis (SaaS maupun jual putus) serta ekspansi **Versi 2** ke berbagai model reservasi lain (villa, rental kendaraan, layanan barbershop/salon, lapangan/fasilitas, dan kelas/sesi).

## 2. Peran Pengguna & Mekanisme Akses

| Peran | Autentikasi | Tanggung Jawab Utama | 
| ----- | ----- | ----- | 
| **Pelanggan (Online)** | **Tanpa Login Akun.** Cukup input **Nama** + **Nomor WhatsApp** saat booking untuk mendapatkan **Kode Booking** dan tautan halaman status publik. | Melihat ketersediaan real-time, memilih tipe/nomor unit spesifik & durasi, membayar DP $50\%$, memantau hitung mundur batas check-in, dan melakukan *reschedule* mandiri ($1\times$). | 
| **Kasir** | Login (Username/Email & Password) | Mencatat sesi *walk-in* langsung (lunas di muka), mencatat/mengarahkan booking jadwal mendatang dengan skema DP $50\%$, menerima pelunasan $50\%$ saat check-in, menekan tombol **Mulai Main (Pegang Stik)**, menyetujui perpanjangan tenggang, menambah durasi (*extend*), dan memindahkan unit setipe. | 
| **Admin / Pemilik** | Login (Username/Email & Password) | Mengelola daftar unit, tipe unit, 4 matriks tarif (Hari Biasa & Hari Minggu), jam operasional, blokir jadwal (*maintenance*/turnamen), membatalkan jadwal pengelola, serta menyelesaikan antrean konflik pembayaran. | 

## 3. Arsitektur & Tech Stack

Sistem menggunakan pola **Decoupled Monorepo** (Backend dan Frontend terpisah dalam satu repositori) dengan spesifikasi produksi:

* **Backend & Worker:** **NestJS (TypeScript)** — Arsitektur modular (*Controller-Service-Repository*) dengan `@nestjs/schedule` untuk *background worker* pengecekan DP kedaluwarsa dan pelepasan slot *no-show*, serta **SSE (Server-Sent Events)** untuk pembaruan layar kasir secara real-time.
* **Database:** **PostgreSQL** — Memanfaatkan tipe rentang waktu `tstzrange` dan constraint `EXCLUDE USING GIST` untuk menjamin jadwal ganda pada unit yang sama mustahil terjadi pada level database.
* **Frontend:** **Next.js (TypeScript)** — Menyediakan halaman publik ringan untuk tautan status booking pelanggan di perangkat mobile sekaligus antarmuka kalender operasional kasir dan panel admin.
* **Deployment & Packaging:** **Docker Compose** (`backend`, `frontend`, `postgres`) agar konsisten dijalankan baik di server cloud SaaS maupun server lokal klien jual putus.

### Struktur Direktori Repositori

```text
mohef-booking/
├── .agents/
├── .docker/
├── backend/                  # NestJS + ORM + PostgreSQL Migrations + Worker
├── frontend/                 # Next.js (Portal Pelanggan, Dashboard Kasir, Panel Admin)
├── docs/                     # Dokumentasi perencanaan & progres
│   ├── PRD_v0.2.md
│   ├── DESIGN_DIRECTION.md
│   └── PROGRESS.md
├── .gitignore
├── AGENTS.md                 # Panduan konteks untuk AI coding agent
├── docker-compose.yml
└── README.md
```

## 4. Cakupan Fitur Versi 1.0

### 4.1 Manajemen Unit, Pilihan Spesifik, & 4 Matriks Tarif

* Pengelola dapat menambah/mengubah unit konsol dengan tipe **Reguler** atau **VIP**.
* Setiap unit merepresentasikan 1 stasiun/ruang bermain yang hanya dapat ditempati 1 booking aktif pada satu rentang waktu.
* **4 Model Tarif Utama:** Sistem membedakan tarif per jam berdasarkan tipe unit dan hari bermain (tanpa tarif khusus malam):
  1. **Reguler — Hari Biasa (Senin–Sabtu)**
  2. **Reguler — Hari Minggu**
  3. **VIP — Hari Biasa (Senin–Sabtu)**
  4. **VIP — Hari Minggu**
  *(Durasi $30\text{ menit}$ dihitung proporsional sebesar $0.5 \times \text{tarif per jam}$ yang berlaku pada hari tersebut).*
* Saat memesan (online maupun via kasir), pengguna dapat memilih **Nomor Unit Spesifik** (misalnya khusus PS #3 karena penyimpanan *save game* lokal) atau memilih opsi **Bebas (Alokasi Otomatis)** agar sistem memilihkan unit tersedia sesuai tipe.

### 4.2 Kalender Grid 30 Menit & Anti-Bentrok

* Seluruh jadwal kalender dikunci pada kelipatan **30 menit** (durasi minimum pemesanan adalah **30 menit**).
* Sistem mencegah tumpang tindih (*overlap*) antar booking online, chat, walk-in, maupun blokir jadwal admin pada unit yang sama, termasuk saat dua permintaan masuk secara bersamaan.
* Booking yang berakhir tepat saat booking berikutnya dimulai (misal `19.00–20.00` diikuti `20.00–21.00`) diizinkan.

### 4.3 Skema Pembayaran (Online, Chat, & Walk-in)

Sistem **tidak menyediakan skema bayar di akhir (*open billing*)**. Seluruh transaksi terbagi dalam dua jalur tegas:

1. **Walk-in Main Langsung (Slot Tersedia Saat Itu Juga):**
   * Jika tamu datang langsung dan unit kosong tersedia saat itu, kasir dapat mencatat sesi langsung tanpa kewajiban input nomor WhatsApp pelanggan.
   * Pembayaran dilakukan **lunas $100\%$ di muka** saat transaksi dicatat di kasir, dan status langsung masuk ke `PLAYING`.
2. **Reservasi Jadwal Mendatang (Online maupun via Chat/Kasir untuk Jam/Hari Lain):**
   * Wajib masuk melalui alur booking sistem (input **Nama** + **Nomor WhatsApp**) dengan pembayaran **DP sebesar $50\%$** dari total biaya sewa.
   * Pada V1, pembayaran online menggunakan antarmuka `PaymentProvider` dengan implementasi awal **Simulasi QRIS / Virtual Account** (siap ditukar ke Midtrans/Xendit via konfigurasi `.env`). Untuk booking yang dibantu catat oleh kasir, kasir mengonfirmasi penerimaan DP $50\%$ (tunai/transfer) agar status berubah menjadi `CONFIRMED`.
   * Saat tagihan DP online dibuat, sistem menahan (*hold*) slot selama **10 menit**.
   * Sebelum membayar, pelanggan ditampilkan ringkasan: tipe & nomor unit, tanggal, jam mulai & selesai, batas maksimal check-in, total biaya (sesuai tarif Hari Biasa/Minggu), nominal DP $50\%$, sisa pelunasan $50\%$ di kasir, serta ketentuan DP hangus apabila *no-show*.
   * Sisa pembayaran $50\%$ **dilunasi di kasir** saat pelanggan tiba dan melakukan check-in.

### 4.4 Kedatangan, Tenggang Check-in, & Perpanjangan Tenggang

* Batas check-in standar adalah $\text{Jam Mulai} + 15\text{ menit}$.
* Pada menit ke-15 jika pelanggan belum check-in, kasir/admin menerima penanda visual pada dashboard dan pelanggan melihat status peringatan pada halaman booking-nya.
* Pelanggan yang terlambat dapat menghubungi kasir/admin sebelum menit ke-15 berakhir untuk meminta **perpanjangan tenggang** dengan aturan:
  1. Maksimal $1\times$ **perpanjangan** per booking dan wajib dicatat kasir sebelum tenggang awal habis.
  2. Tambahan tenggang maksimal $+15\text{ menit}$ (total maksimal $30\text{ menit}$ dari jam mulai).
  3. Sisa waktu bermain efektif setelah batas check-in baru wajib minimal $15\text{ menit}$ (konsekuensinya, booking berdurasi $30\text{ menit}$ tidak dapat memperpanjang tenggang).
  4. Perpanjangan tenggang **tidak menggeser jam selesai kalender**.

### 4.5 Timer Main Aktual ("Pegang Stik")

* Waktu persiapan singkat perpindahan pemain dan penyerahan stik ($\le 5\text{ menit}$) tidak mengubah slot grid kalender.
* Setelah pelanggan menerima stik dan siap bermain, kasir menekan tombol **Mulai Main (Pegang Stik)** untuk menjalankan timer sesi:
  * **Jika tidak ada booking berikutnya pada unit tersebut:** Pelanggan bermain penuh sesuai durasi paket terhitung sejak tombol *Mulai Main* ditekan.
  * **Jika ada booking berikutnya pada unit yang sama:** Jam selesai mengikuti **jam selesai kalender awal** agar jadwal pemesan berikutnya tidak tertunda.

### 4.6 Pelepasan Slot Otomatis (*No-Show*)

* Apabila pelanggan belum check-in hingga batas check-in efektif (standar maupun hasil perpanjangan) terlewati:
  1. Status booking otomatis berubah menjadi **Tidak Hadir (`NO_SHOW`)**.
  2. DP $50\%$ dipertahankan oleh pengelola sesuai ketentuan awal.
  3. Sistem menghitung interval dari batas check-in efektif hingga jam selesai kalender awal. Jika sisa durasi $\ge 30\text{ menit}$, interval tersebut otomatis dibuka kembali ke kalender sebagai slot yang dapat dipesan ulang. Jika sisa durasi $< 30\text{ menit}$, slot tidak dijual kembali.

### 4.7 Reschedule, Tambah Durasi (*Extend*), & Pindah Unit

* **Reschedule Mandiri / Kasir:** Pelanggan dapat mengubah jadwal maksimal $1\times$ melalui halaman status publik (atau dibantu kasir) paling lambat $1\text{ jam}$ **sebelum jam mulai**, selama unit setipe/pilihan tersedia pada jadwal baru. *(Catatan: jika reschedule berpindah antara Hari Biasa dan Hari Minggu, selisih tarif disesuaikan saat pelunasan di kasir).*
* **Tambah Durasi (*Extend*):** Kasir dapat menambah durasi sesi pelanggan yang sedang bermain dalam kelipatan **30 menit** apabila slot setelahnya pada unit tersebut kosong, dengan pembayaran langsung di muka di kasir sesuai tarif hari berjalan.
* **Pindah Unit Setipe:** Kasir dapat memindahkan sesi aktif atau terjadwal ke nomor unit lain dengan **tipe yang sama** (misal dari PS Reguler #2 ke PS Reguler #4 karena kendala stik/perangkat) selama unit tujuan kosong.

## 5. Siklus Status Booking (*State Machine*)

| Status | Deskripsi | Menahan Slot Kalender? | 
| ----- | ----- | ----- | 
| `HOLD_DP` | Menunggu pembayaran DP online (berlaku 10 menit). | Ya (Sementara) | 
| `EXPIRED` | Batas waktu pembayaran DP 10 menit habis tanpa pembayaran. | Tidak (Dilepas) | 
| `CONFIRMED` | DP $50\%$ terverifikasi atau dicatat kasir; menunggu kedatangan. | Ya | 
| `PLAYING` | Pelanggan sudah check-in & lunas (atau walk-in langsung lunas), tombol *Mulai Main* aktif. | Ya | 
| `COMPLETED` | Sesi bermain telah selesai. | Tidak (Historis) | 
| `NO_SHOW` | Melewati batas check-in efektif tanpa hadir; sisa slot $\ge 30\text{ menit}$ dibuka ulang. | Tidak (Sisa dilepas) | 
| `CANCELLED` | Dibatalkan oleh pengelola (refund penuh) atau dibatalkan sesuai kebijakan. | Tidak (Dilepas) | 
| `CONFLICT_REVIEW` | Webhook pembayaran DP masuk terlambat setelah `HOLD_DP` kedaluwarsa dan slot sudah diisi booking lain. Masuk antrean penanganan admin. | Tidak (Ditangani Admin) | 

## 6. Skenario Penerimaan (Acceptance Criteria)

1. **Booking VIP Unit Spesifik & Tarif Minggu:** Pelanggan memilih VIP #2 pada hari Minggu pukul `19.00–20.00` dengan input Nama & WhatsApp. Sistem menghitung tarif VIP Minggu, dan setelah DP $50\%$ terverifikasi dalam $< 10\text{ menit}$, status menjadi `CONFIRMED`. Kasir tidak dapat membuat booking lain di VIP #2 pada rentang tersebut.
2. **Walk-in Langsung vs Booking Jam Lain:** Tamu walk-in yang ingin langsung main di unit kosong dicatat kasir sebagai lunas $100\%$ di muka (`PLAYING`). Jika tamu walk-in ingin memesan slot $2\text{ jam}$ lagi, kasir wajib membuatkan booking dengan input Nama + WhatsApp serta DP $50\%$.
3. **Terlambat dengan Konfirmasi Tenggang:** Pada booking `19.00–20.00`, sebelum `19.15` kasir mencatat perpanjangan tenggang hingga `19.25`. Pelanggan tiba pukul `19.20`, melunasi $50\%$, dan bermain hingga maksimal `20.00`.
4. **Tidak Hadir Tanpa Konfirmasi (*No-Show*):** Pada booking `19.00–20.00`, pelanggan tidak check-in hingga `19.15` tanpa perpanjangan tenggang. Status menjadi `NO_SHOW`, DP $50\%$ ditahan, dan slot `19.15–20.00` (45 menit, $\ge 30\text{ menit}$) kembali tersedia di kalender.
5. **Sisa Slot Terlalu Pendek:** Pada booking `19.00–20.00` yang diperpanjang tenggangnya hingga `19.35`, pelanggan tetap tidak hadir. Sisa waktu $25\text{ menit}$ ($< 30\text{ menit}$) tidak dibuka kembali sebagai slot pemesanan.
6. **Timer Pegang Stik (Slot Kosong vs Ada Antrean):** Pelanggan booking `19.00–20.00` baru mulai pegang stik pukul `19.04`. Jika slot `20.00–21.00` kosong, timer berjalan hingga `20.04`. Jika ada booking pukul `20.00`, timer tetap berakhir pukul `20.00`.
7. **Pembayaran Terlambat & Bentrok:** Pelanggan membayar DP pada menit ke-12 setelah `HOLD_DP` habis dan unit sudah dipesan orang lain. Sistem tidak menimpa jadwal aktif, melainkan mencatat transaksi ke status `CONFLICT_REVIEW` untuk diproses admin.

## 7. Fondasi Database Multi-Tenant & Roadmap Versi 2.0

* **Isolasi Tenant (`tenant_id`):** Seluruh tabel inti (`tenants`, `units`, `bookings`, `payments`, `booking_audit_logs`) menyertakan `tenant_id`. Deployment jual putus memakai 1 tenant default; deployment SaaS memakai multi-tenant dalam satu instance.
* **Abstraksi Mode Booking (`booking_mode`):** Tabel `tenants` menyimpan atribut `booking_mode` (V1 dikunci pada `HOURLY_UNIT`). Pada **Versi 2.0**, arsitektur dapat diperluas dengan menambahkan *engine* jadwal baru tanpa mengubah modul pembayaran maupun tenant:
  * `NIGHTLY_UNIT`: Villa / penginapan per malam (aturan *check-in/check-out* harian).
  * `FLEET_RENTAL`: Rental motor/mobil (jadwal ambil-kembali & kondisi serah terima unit).
  * `SERVICE_APPOINTMENT`: Barbershop/salon/konsultasi (ketersediaan staf & durasi layanan).
  * `FACILITY_RESERVATION`: Meja kafe, lapangan olahraga, ruang rapat.
  * `SESSION_QUOTA`: Kelas gym atau workshop berbasis kuota peserta per sesi.