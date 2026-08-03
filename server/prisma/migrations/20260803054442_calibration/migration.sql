-- CreateTable
CREATE TABLE "calibration_profiles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "side" TEXT NOT NULL,
    "sensor_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "quality" REAL NOT NULL,
    "source_start" INTEGER NOT NULL,
    "source_end" INTEGER NOT NULL,
    "samples_used" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "calibration_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "side" TEXT NOT NULL,
    "sensor_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "started_at" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "quality" REAL,
    "message" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "calibration_profiles_side_sensor_type_key" ON "calibration_profiles"("side", "sensor_type");

-- CreateIndex
CREATE INDEX "calibration_runs_side_started_at_idx" ON "calibration_runs"("side", "started_at");
