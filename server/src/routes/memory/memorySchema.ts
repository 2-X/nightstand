// WARNING! - Any changes here MUST be the same between app/src/api & server/src/db/
import { z } from 'zod';

export const MemoryInfoSchema = z.object({
  totalBytes: z.number(),
  usedBytes: z.number(),
  availableBytes: z.number(),
  usedPercent: z.number(),
});

export type MemoryInfo = z.infer<typeof MemoryInfoSchema>;
