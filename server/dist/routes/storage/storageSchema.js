// WARNING! - Any changes here MUST be the same between app/src/api & server/src/db/
import { z } from 'zod';
export const StorageInfoSchema = z.object({
    mountPath: z.string(),
    totalBytes: z.number(),
    usedBytes: z.number(),
    availableBytes: z.number(),
    usedPercent: z.number(),
    breakdown: z.object({
        logsBytes: z.number(),
        biometricsArchiveBytes: z.number(),
        databaseBytes: z.number(),
    }),
});
//# sourceMappingURL=storageSchema.js.map