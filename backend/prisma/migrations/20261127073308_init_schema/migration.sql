-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('REGULER', 'VIP');

-- CreateEnum
CREATE TYPE "DayCategory" AS ENUM ('WEEKDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('ONLINE', 'CHAT', 'WALK_IN');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HOLD_DP', 'EXPIRED', 'CONFIRMED', 'PLAYING', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'CONFLICT_ADMIN');

-- CreateEnum
CREATE TYPE "BookingPaymentStatus" AS ENUM ('UNPAID', 'DP_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('SIMULATOR', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('QRIS', 'VA', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DP', 'SETTLEMENT', 'DIRECT_FULL', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('CUSTOMER', 'CASHIER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "booking_mode" TEXT NOT NULL DEFAULT 'hourly_unit',
    "open_time" TEXT NOT NULL DEFAULT '10:00',
    "close_time" TEXT NOT NULL DEFAULT '23:00',
    "dp_hold_minutes" INTEGER NOT NULL DEFAULT 10,
    "grace_period_minutes" INTEGER NOT NULL DEFAULT 15,
    "max_grace_extension_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "UnitType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_type" "UnitType" NOT NULL,
    "day_category" "DayCategory" NOT NULL,
    "hourly_rate" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rate_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "booking_code" TEXT NOT NULL,
    "source" "BookingSource" NOT NULL,
    "customer_name" TEXT,
    "customer_whatsapp" TEXT,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "actual_play_start_at" TIMESTAMPTZ,
    "effective_checkin_deadline" TIMESTAMPTZ NOT NULL,
    "grace_extended_count" INTEGER NOT NULL DEFAULT 0,
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "status" "BookingStatus" NOT NULL DEFAULT 'HOLD_DP',
    "total_amount" INTEGER NOT NULL,
    "dp_amount" INTEGER NOT NULL,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "payment_status" "BookingPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "type" "PaymentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ,
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_role" "ActorRole" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_blocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "schedule_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "units_tenant_id_type_is_active_idx" ON "units"("tenant_id", "type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenant_id_code_key" ON "units"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "rate_rules_tenant_id_unit_type_day_category_key" ON "rate_rules"("tenant_id", "unit_type", "day_category");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_code_key" ON "bookings"("booking_code");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_status_start_at_idx" ON "bookings"("tenant_id", "status", "start_at");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_unit_id_start_at_idx" ON "bookings"("tenant_id", "unit_id", "start_at");

-- CreateIndex
CREATE INDEX "bookings_status_effective_checkin_deadline_idx" ON "bookings"("status", "effective_checkin_deadline");

-- CreateIndex
CREATE INDEX "payments_tenant_id_booking_id_idx" ON "payments"("tenant_id", "booking_id");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "booking_logs_tenant_id_booking_id_created_at_idx" ON "booking_logs"("tenant_id", "booking_id", "created_at");

-- CreateIndex
CREATE INDEX "schedule_blocks_tenant_id_start_at_end_at_idx" ON "schedule_blocks"("tenant_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "schedule_blocks_tenant_id_unit_id_start_at_idx" ON "schedule_blocks"("tenant_id", "unit_id", "start_at");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_logs" ADD CONSTRAINT "booking_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_logs" ADD CONSTRAINT "booking_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
