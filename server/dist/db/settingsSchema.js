import { z } from 'zod';
import { TIME_ZONES } from './timeZones.js';
import { TimeSchema } from './schedulesSchema.js';
export const TEMPERATURES = ['celsius', 'fahrenheit'];
const Temperatures = z.enum(TEMPERATURES);
const SideSettingsSchema = z.object({
    name: z.string().min(1).max(20),
    awayMode: z.boolean(),
}).strict();
export const SettingsSchema = z.object({
    timeZone: z.enum(TIME_ZONES).nullable(),
    left: SideSettingsSchema,
    right: SideSettingsSchema,
    primePodDaily: z.object({
        enabled: z.boolean(),
        time: TimeSchema,
    }),
    temperatureFormat: Temperatures,
    rebootDaily: z.boolean(),
}).strict();
