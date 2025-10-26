
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="76e52d11-d9b0-5f3f-896e-a7b5ee6993d5")}catch(e){}}();
import { z } from 'zod';
export const vitalsRecordSchema = z.object({
    side: z.enum(['right', 'left']),
    timestamp: z.number().int(), // Epoch timestamp
    heart_rate: z.number().int().min(30).max(90),
    hrv: z.number().int().min(0).max(200),
    breathing_rate: z.number().int().min(5).max(30), // Normal breathing rate range
});
//# sourceMappingURL=vitalsRecordSchema.js.map
//# debugId=76e52d11-d9b0-5f3f-896e-a7b5ee6993d5
