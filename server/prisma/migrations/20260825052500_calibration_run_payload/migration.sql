-- AlterTable
ALTER TABLE "calibration_runs" ADD COLUMN "payload" TEXT;
ALTER TABLE "calibration_runs" ADD COLUMN "source_start" INTEGER;
ALTER TABLE "calibration_runs" ADD COLUMN "source_end" INTEGER;
