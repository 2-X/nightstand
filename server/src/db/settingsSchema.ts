import { z } from 'zod';
import { TIME_ZONES } from './timeZones.js';
import { TimeSchema } from './schedulesSchema.js';

// Display formats. 'level' is the -10..+10 scale used by the official Pod app
// (where -10 = coldest, 0 = neutral, +10 = warmest). All three map to the same
// internal Fahrenheit value; the choice is display-only.
export const TEMPERATURES = ['fahrenheit', 'celsius', 'level'] as const;
const Temperatures = z.enum(TEMPERATURES);


const TemperatureTapConfig = z.object({
  type: z.literal('temperature'),
  change: z.enum(['increment', 'decrement']),
  amount: z.number().min(0).max(10),
});

const AlarmTapConfig = z.object({
  type: z.literal('alarm'),
  behavior: z.enum(['snooze', 'dismiss']),
  snoozeDuration: z.number().min(60).max(600),
  inactiveAlarmBehavior: z.enum(['power', 'none'])
});

export const TapConfig = z.discriminatedUnion('type', [
  TemperatureTapConfig,
  AlarmTapConfig,
]);

export const GestureSchema = z.enum(['doubleTap', 'tripleTap', 'quadTap']);

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
  taps: z.object({
    doubleTap: TapConfig,
    tripleTap: TapConfig,
    quadTap: TapConfig,
  })
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
export type Gesture = z.infer<typeof GestureSchema>
