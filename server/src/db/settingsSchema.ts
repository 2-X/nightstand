import { z } from 'zod';
import { TIME_ZONES } from './timeZones.js';
import { TimeSchema } from './schedulesSchema.js';

export const TEMPERATURES = ['celsius', 'fahrenheit'] as const;
const Temperatures = z.enum(TEMPERATURES);
export type TemperatureFormat = z.infer<typeof Temperatures>;

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

export type SideSettings = z.infer<typeof SideSettingsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
