import { z } from 'zod';

export const sleepRecordSchema = z.object({
  id: z.number().int(),
  side: z.string(),
  entered_bed_at: z.string().datetime({ offset: true }),
  left_bed_at: z.string().datetime({ offset: true }),
  sleep_period_seconds: z.number().int(),
  times_exited_bed: z.number().int(),
  present_intervals: z.array(z.tuple([z.string().datetime({ offset: true }), z.string().datetime({ offset: true })])),
  not_present_intervals: z.array(z.tuple([z.string().datetime({ offset: true }), z.string().datetime({ offset: true })])),
});

// TypeScript type inference from Zod
export type SleepRecord = z.infer<typeof sleepRecordSchema>;
