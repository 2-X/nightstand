-- CreateTable
CREATE TABLE "water_level_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" INTEGER NOT NULL,
    "level" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "water_level_events_timestamp_idx" ON "water_level_events"("timestamp");
