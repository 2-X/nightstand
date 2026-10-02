// WARNING! - Any changes here MUST be the same between app/src/api & server/src/routes/update
import { z } from 'zod';

export const UpdateRequestSchema = z.object({
  targetVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  allowDowngrade: z.boolean().optional(),
  confirmInUse: z.boolean().optional(),
}).strict();

export const OperationRequestSchema = z.object({
  confirmInUse: z.boolean().optional(),
}).strict();

export const RollbackInfoSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
});

export const UpdateResultSchema = z.object({
  runId: z.string(),
  operation: z.enum(['update', 'rollback', 'switch']),
  outcome: z.enum(['success', 'up-to-date', 'stopped', 'rolled-back', 'failed']),
  from: z.string().nullable(),
  to: z.string().nullable(),
  message: z.string(),
  finishedAt: z.string(),
});

export type OperationRequest = z.infer<typeof OperationRequestSchema>;
export type UpdateRequest = z.infer<typeof UpdateRequestSchema>;
export type RollbackInfo = z.infer<typeof RollbackInfoSchema>;
export type UpdateResult = z.infer<typeof UpdateResultSchema>;
