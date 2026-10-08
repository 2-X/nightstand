import { z } from 'zod';
import { SideSchema } from './schedulesSchema.js';

// Columns filled by the newer estimators: absent with new sleep tracking off,
// null on older rows and wherever an estimate failed its quality check.
const estimate = z.number().nullable().optional();

export const vitalsRecordSchema = z.object({
  side: SideSchema,
  // Epoch seconds, exactly as stored. The vitals route returns rows
  // untransformed, and the client scales to milliseconds itself.
  timestamp: z.number().int(),
  // Any stored value is accepted so one unusual row cannot hide a whole
  // night; the page decides what to show.
  heart_rate: z.number().min(0),
  // 0 is the no-reading sentinel the stream writes when a metric has not been
  // computed yet for the current session, so the floor is 0 rather than the
  // bottom of the plausible physiological range. Consumers exclude it by
  // value; see the vitals writer for why a session can open without one.
  hrv: z.number().min(0),
  breathing_rate: z.number().min(0),
  hr_quality: estimate,
  rmssd: estimate,
  sdnn: estimate,
  hrv_coverage: estimate,
  resp_rate: estimate,
  resp_quality: estimate,
  estimator: z.number().int().nullable().optional(),
});

export type VitalsRecord = z.infer<typeof vitalsRecordSchema>;

export type VitalsSummary = {
  avgHeartRate: number;
  minHeartRate: number;
  maxHeartRate: number;
  avgHRV: number;
  avgBreathingRate: number;
  retained?: { avgHeartRate: number; avgBreathingRate: number };
};
