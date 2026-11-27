-- Enable btree_gist so scalar unit_id (=) can be combined with tstzrange (&&) in GiST exclusion
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
ADD CONSTRAINT "bookings_end_after_start_check"
CHECK ("end_at" > "start_at");

ALTER TABLE "schedule_blocks"
ADD CONSTRAINT "schedule_blocks_end_after_start_check"
CHECK ("end_at" > "start_at");

ALTER TABLE "bookings"
ADD CONSTRAINT "bookings_no_overlap_active_excl"
EXCLUDE USING GIST (
    "unit_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
)
WHERE ("status" IN ('HOLD_DP', 'CONFIRMED', 'PLAYING'));
