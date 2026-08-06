import { z } from 'zod';
import { SideSchema } from './schedulesSchema.js';
export const vitalsRecordSchema = z.object({
    side: SideSchema,
    // Epoch seconds, exactly as stored. The vitals route returns rows
    // untransformed, and the client scales to milliseconds itself.
    timestamp: z.number().int(),
    heart_rate: z.number().int().min(30).max(90),
    // 0 is the no-reading sentinel the stream writes when a metric has not been
    // computed yet for the current session, so the floor is 0 rather than the
    // bottom of the plausible physiological range. Consumers exclude it by
    // value; see the vitals writer for why a session can open without one.
    hrv: z.number().int().min(0).max(200),
    breathing_rate: z.number().int().min(0).max(30),
});
//# sourceMappingURL=vitalsRecordSchema.js.map