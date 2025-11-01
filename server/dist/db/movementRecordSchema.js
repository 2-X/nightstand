
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="9f6311d9-0af1-5275-ae43-972e4a4e211b")}catch(e){}}();
import { z } from 'zod';
export const movementRecordSchema = z.object({
    id: z.number(),
    side: z.enum(['right', 'left']),
    timestamp: z.number().int(), // Epoch timestamp
    total_movement: z.number().int()
});
//# sourceMappingURL=movementRecordSchema.js.map
//# debugId=9f6311d9-0af1-5275-ae43-972e4a4e211b
