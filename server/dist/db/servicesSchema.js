// WARNING! - Any changes here MUST be the same between app/src/api & server/src/db/
import { z } from 'zod';
import { StatusInfoSchema } from '../routes/serverStatus/serverStatusSchema.js';
export const SensorTempsSchema = z.object({
    ambient: z.number().nullable(),
    heatsink: z.number().nullable(),
    left: z.number().nullable(),
    right: z.number().nullable(),
    lastUpdated: z.string().nullable(),
});
export const ServicesSchema = z.object({
    biometrics: z.object({
        enabled: z.boolean(),
        jobs: z.object({
            analyzeSleepLeft: StatusInfoSchema,
            analyzeSleepRight: StatusInfoSchema,
            installation: StatusInfoSchema,
            stream: StatusInfoSchema,
            calibrateLeft: StatusInfoSchema,
            calibrateRight: StatusInfoSchema,
            pumpLeft: StatusInfoSchema,
            pumpRight: StatusInfoSchema,
        }),
        sensorTemps: SensorTempsSchema.optional(),
    }),
}).strict();
//# sourceMappingURL=servicesSchema.js.map