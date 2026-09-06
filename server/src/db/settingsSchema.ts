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

const BaseControlTapConfig = z.object({
  type: z.literal('base_control'),
  behavior: z.literal('toggle_preset'),
});

export const TapConfig = z.discriminatedUnion('type', [
  TemperatureTapConfig,
  AlarmTapConfig,
  BaseControlTapConfig,
]);

export const GestureSchema = z.enum(['doubleTap', 'tripleTap', 'quadTap']);

// alarmScheduler arms real jobs off these strings, and moment overflows or
// no-ops on garbage instead of rejecting it ('25:00' would fire at 01:00 the
// next day), so they are validated here rather than downstream. Empty string
// is the stored "unset" value (see db/settings.ts defaults) and stays valid.
const UNSET = z.literal('');
const OptionalTimeSchema = z.union([UNSET, TimeSchema]);
const OptionalDateTimeSchema = z.union([UNSET, z.string().datetime({ offset: true })]);

// One-off alarm: fires once at fireAt then disables itself. Independent of
// the recurring per-day-of-week alarm. fireAt is an ISO 8601 datetime
// including offset, e.g. "2026-04-30T07:00:00-07:00".
const OneOffAlarmSchema = z.object({
  enabled: z.boolean(),
  fireAt: OptionalDateTimeSchema,
  vibrationIntensity: z.number().int().min(1).max(100),
  vibrationPattern: z.enum(['double', 'rise']),
  duration: z.number().int().min(0).max(180),
});

// Pod 5 cover physical-button behavior (buttonMonitor.ts). The Pod 5 cover has
// three buttons per side (+ / logo / -) wired to a TCA8418 keypad the stock
// frank firmware deliberately ignores; buttonMonitor tails the RAW capture for
// the press events and applies these actions instead.
//
// Defaults: top click = +stepF, bottom click = -stepF, middle double-click =
// dismiss a vibrating alarm on that side (else no-op).
//
//  - invertButtons: swaps which physical button is treated as top vs bottom.
//    The physical top/bottom -> +/- assignment is UNVERIFIED on this hardware,
//    so this lets the user flip it live without a code change if +/- come out
//    reversed.
//  - stepF: degrees Fahrenheit per single top/bottom click.
//  - doubleClickWindowMs: max gap between two middle clicks to count as a
//    double-click (alarm dismiss).
//  - hapticEcho: fire a short confirmation vibration after a handled
//    temperature press. DEFAULT OFF - unsolicited midnight buzzing is worse
//    than no echo; enable after live testing.
const ButtonsConfigSchema = z.object({
  invertButtons: z.boolean(),
  stepF: z.number().min(0).max(10),
  doubleClickWindowMs: z.number().int().min(200).max(5000),
  hapticEcho: z.boolean(),
}).strict();

const SideSettingsSchema = z.object({
  name: z.string().min(1).max(20),
  awayMode: z.boolean(),
  alarmsEnabled: z.boolean(),
  scheduleOverrides: z.object({
    temperatureSchedules: z.object({
      disabled: z.boolean(),
      expiresAt: OptionalDateTimeSchema,
    }),
    alarm: z.object({
      disabled: z.boolean(),
      timeOverride: OptionalTimeSchema,
      expiresAt: OptionalDateTimeSchema,
    })
  }),
  oneOffAlarm: OneOffAlarmSchema,
  taps: z.object({
    doubleTap: TapConfig,
    tripleTap: TapConfig,
    quadTap: TapConfig,
  }),
  buttons: ButtonsConfigSchema,
}).strict();

// Which release channel the update alert/version picker treats as "latest".
// 'beta' sees every release; 'stable' only sees releases promoted to stable
// in releases.json.
export const UPDATE_CHANNELS = ['stable', 'beta'] as const;
const UpdateChannel = z.enum(UPDATE_CHANNELS);

// Runtime feature flags. Biometrics has its own toggle in ServicesSchema
// (install precondition, systemd side effect) and stays there rather than
// joining this list. nightstandTheme has no code reading it yet, it is a
// placeholder for a future dual-theme pass.
export const defaultFeatures = {
  sleepScore: true,
  levelTemps: true,
  oneOffAlarms: true,
  nightstandTheme: true,
  // Master enable for the Pod 5 cover-button monitor (buttonMonitor.ts). When
  // false the tailer never starts; the RAW file is left untouched.
  coverButtons: true,
} as const;
const FeaturesSchema = z.object({
  sleepScore: z.boolean(),
  levelTemps: z.boolean(),
  oneOffAlarms: z.boolean(),
  nightstandTheme: z.boolean(),
  coverButtons: z.boolean(),
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
  updateChannel: UpdateChannel,
  features: FeaturesSchema,
}).strict();

export type ButtonsConfig = z.infer<typeof ButtonsConfigSchema>;
export type SideSettings = z.infer<typeof SideSettingsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Features = z.infer<typeof FeaturesSchema>;
export type Gesture = z.infer<typeof GestureSchema>
export type UpdateChannelType = z.infer<typeof UpdateChannel>
