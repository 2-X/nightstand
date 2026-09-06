-- CreateTable
CREATE TABLE "bed_state_samples" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "side" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "current_level" INTEGER,
    "target_level" INTEGER,
    "current_temp_f" REAL,
    "target_temp_f" REAL,
    "is_on" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "hub_state_samples" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" INTEGER NOT NULL,
    "ambient_c" REAL,
    "heatsink_c" REAL,
    "left_c" REAL,
    "right_c" REAL,
    "water_ok" BOOLEAN,
    "is_priming" BOOLEAN,
    "wifi_strength" INTEGER
);

-- CreateTable
CREATE TABLE "pod_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "side" TEXT,
    "payload" TEXT NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "config_audit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "bed_state_samples_side_timestamp_idx" ON "bed_state_samples"("side", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "bed_state_samples_side_timestamp_key" ON "bed_state_samples"("side", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "hub_state_samples_timestamp_key" ON "hub_state_samples"("timestamp");

-- CreateIndex
CREATE INDEX "pod_events_type_timestamp_idx" ON "pod_events"("type", "timestamp");

-- CreateIndex
CREATE INDEX "pod_events_timestamp_idx" ON "pod_events"("timestamp");

-- CreateIndex
CREATE INDEX "config_audit_kind_timestamp_idx" ON "config_audit"("kind", "timestamp");
