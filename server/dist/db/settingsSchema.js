
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="13376981-2972-5abd-b38b-3aa30e29f4dc")}catch(e){}}();
import { z } from 'zod';
import { TIME_ZONES } from './timeZones.js';
import { TimeSchema } from './schedulesSchema.js';
export const TEMPERATURES = ['celsius', 'fahrenheit'];
const Temperatures = z.enum(TEMPERATURES);
const SideSettingsSchema = z.object({
    name: z.string().min(1).max(20),
    awayMode: z.boolean(),
    scheduleOverrides: z.object({
        temperatureSchedules: z.object({
            disabled: z.boolean(),
            expiresAt: z.string(),
        }),
        alarm: z.object({
            disabled: z.boolean(),
            timeOverride: z.string(),
            expiresAt: z.string(),
        })
    }),
}).strict();
export const SettingsSchema = z.object({
    id: z.string(),
    timeZone: z.enum(TIME_ZONES),
    left: SideSettingsSchema,
    right: SideSettingsSchema,
    primePodDaily: z.object({
        enabled: z.boolean(),
        time: TimeSchema,
    }),
    temperatureFormat: Temperatures,
    rebootDaily: z.boolean(),
}).strict();
//# sourceMappingURL=settingsSchema.js.map
//# debugId=13376981-2972-5abd-b38b-3aa30e29f4dc
