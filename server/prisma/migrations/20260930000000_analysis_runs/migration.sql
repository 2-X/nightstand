BEGIN;
CREATE TABLE "analysis_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "side" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "started_at" INTEGER NOT NULL,
    "finished_at" INTEGER,
    "window_start" INTEGER NOT NULL,
    "window_end" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "rows_loaded" INTEGER,
    "records_written" INTEGER,
    "movement_written" INTEGER,
    "duration_ms" INTEGER,
    "peak_rss_mb" REAL,
    "error" TEXT,
    "code_version" TEXT
);
CREATE INDEX "analysis_runs_side_started_at_idx" ON "analysis_runs"("side", "started_at");
COMMIT;
