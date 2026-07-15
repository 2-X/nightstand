// WARNING! - Any changes here MUST be the same between app/src/api & server/src/routes/update
import { z } from 'zod';

export const UpdateRequestSchema = z.object({
  targetVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  allowDowngrade: z.boolean().optional(),
}).strict();

export const RollbackInfoSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
});

export type UpdateRequest = z.infer<typeof UpdateRequestSchema>;
export type RollbackInfo = z.infer<typeof RollbackInfoSchema>;
