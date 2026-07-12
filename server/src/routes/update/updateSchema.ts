// WARNING! - Any changes here MUST be the same between app/src/api & server/src/routes/update
import { z } from 'zod';

export const RollbackInfoSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
});

export type RollbackInfo = z.infer<typeof RollbackInfoSchema>;
