
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="14490237-33d6-5c40-924e-218339f02206")}catch(e){}}();
import { z } from 'zod';
export const movementRecordSchema = z.object({
    side: z.enum(['right', 'left']),
    timestamp: z.number().int(), // Epoch timestamp
    total_movement: z.number().int()
});
//# sourceMappingURL=movementRecordSchema.js.map
//# debugId=14490237-33d6-5c40-924e-218339f02206
