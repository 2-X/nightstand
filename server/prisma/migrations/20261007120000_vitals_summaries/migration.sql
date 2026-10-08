BEGIN;
CREATE TABLE "vitals_summaries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "side" TEXT NOT NULL,
    "entered_bed_at" INTEGER NOT NULL,
    "left_bed_at" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    CONSTRAINT "vitals_summaries_side_entered_bed_at_left_bed_at_key"
        UNIQUE ("side", "entered_bed_at", "left_bed_at")
);
COMMIT;
