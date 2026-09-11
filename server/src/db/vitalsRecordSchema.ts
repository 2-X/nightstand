import { z } from 'zod';
import { SideSchema } from './schedulesSchema.js';

export const vitalsRecordSchema = z.object({
  side: SideSchema,
  // Epoch seconds, exactly as stored. The vitals route returns rows
  // untransformed, and the client scales to milliseconds itself.
  timestamp: z.number().int(),
  heart_rate: z.number().int().min(30).max(90),
  // New unavailable estimates are null; legacy zero sentinels remain readable.
  hrv: z.number().int().min(0).max(200).nullable(),
  hrv_timestamp: z.number().int().nullable().optional(),
  breathing_rate: z.number().int().min(0).max(30).nullable(),
  breathing_timestamp: z.number().int().nullable().optional(),
});

export type VitalsRecord = z.infer<typeof vitalsRecordSchema>;

export type VitalsSummary = {
  avgHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  avgHRV: number | null;
  avgBreathingRate: number | null;
};
