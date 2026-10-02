BEGIN;
ALTER TABLE "vitals" ADD COLUMN "hr_quality" REAL;
ALTER TABLE "vitals" ADD COLUMN "rmssd" REAL;
ALTER TABLE "vitals" ADD COLUMN "sdnn" REAL;
ALTER TABLE "vitals" ADD COLUMN "hrv_coverage" REAL;
ALTER TABLE "vitals" ADD COLUMN "resp_rate" REAL;
ALTER TABLE "vitals" ADD COLUMN "resp_quality" REAL;
ALTER TABLE "vitals" ADD COLUMN "estimator" INTEGER;
COMMIT;
