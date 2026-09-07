// WARNING! - Any changes here MUST be the same between app/src/api & server/src/db/

import { z } from 'zod';
const timeRegexFormat = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const SideSchema = z.enum(['right', 'left']);


// Reusable Zod type for time
export const TimeSchema = z.string().regex(timeRegexFormat, 'Invalid time format, must be HH:mm');
export const TemperatureSchema = z.number().int().min(55).max(110);


export const AlarmSchema = z.object({
  vibrationIntensity: z.number().int().min(1).max(100),
  vibrationPattern: z.enum(['double', 'rise']),
  duration: z.number().int().positive().min(0).max(300),
}).strict();

export const AlarmJobSchema = AlarmSchema.extend({
  side: SideSchema,
  force: z.boolean().optional(),
  // Deadline alarms opt into re-firing at full intensity every 45s (up to 10
  // min) until dismissed, so a single short buzz can't be slept through. The
  // "fire now" API and the alarm test leave this off (a single buzz).
  refireUntilDismissed: z.boolean().optional(),
}).strict();

export const AlarmScheduleSchema = AlarmSchema.extend({
  time: TimeSchema,
  enabled: z.boolean(),
  alarmTemperature: TemperatureSchema,
}).strict();

// Each alarm registers its own node-schedule job on the pod, so an unbounded
// array is a cheap way to bury the scheduler. Ten covers any real day.
export const MAX_ALARMS_PER_DAY = 10;
export const AlarmSchedulesSchema = z.array(AlarmScheduleSchema).max(MAX_ALARMS_PER_DAY);


// --- Phase 2: recurring alarms ---------------------------------------------
// A side-level, unlimited list of alarms that carry their own recurrence rule
// instead of living inside a per-day-of-week bucket. The legacy per-day
// `alarm`/`alarms` fields stay on DailySchedule for backward compatibility
// (older editor screens still read them); the migration shim in
// db/schedules.ts folds the enabled legacy alarms into this list on first read
// and the scheduler arms jobs from here.

// customDays / weekday indexes: 0=Sunday .. 6=Saturday (matches
// node-schedule's dayOfWeek and JS Date.getDay()).
export const DayIndexSchema = z.number().int().min(0).max(6);

// Discriminated union so each recurrence kind only carries the fields it needs
// and Zod rejects a customDays list on a `daily` alarm etc.
export const RecurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }).strict(),
  z.object({ kind: z.literal('weekdays') }).strict(), // Mon-Fri (1-5)
  z.object({ kind: z.literal('weekends') }).strict(), // Sat-Sun (0,6)
  z.object({
    kind: z.literal('customDays'),
    // Non-empty set of weekday indexes.
    days: z.array(DayIndexSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal('everyNDays'),
    n: z.number().int().min(1).max(365),
    // Anchor day the interval counts from, ISO date "YYYY-MM-DD" (local).
    anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'anchorDate must be YYYY-MM-DD'),
  }).strict(),
]);

export const VibrationSchema = z.object({
  intensity: z.number().int().min(1).max(100),
  duration: z.number().int().min(0).max(300),
  pattern: z.enum(['double', 'rise']),
}).strict();

// Sleep Cycle-style smart wake. When enabled, a session starts
// `windowMinutes` before the alarm's deadline time and tries to nudge the
// sleeper out of LIGHT sleep with gentle escalating pulses, so they wake
// feeling rested instead of yanked out of deep sleep at the deadline.
//
// HARD GUARANTEE: the deadline alarm still fires at the configured time no
// matter what the session does (see alarmScheduler). The smart layer only
// ADDS earlier wakes; it can never remove or delay the deadline.
//
// Optional on the alarm + `windowMinutes` defaulted, so existing alarm rows
// with no `smartWake` key parse unchanged (migration safe).
export const SMART_WAKE_MIN_WINDOW_MINUTES = 5;
export const SMART_WAKE_MAX_WINDOW_MINUTES = 60;
export const SMART_WAKE_DEFAULT_WINDOW_MINUTES = 30;
export const SmartWakeSchema = z.object({
  enabled: z.boolean(),
  windowMinutes: z.number().int()
    .min(SMART_WAKE_MIN_WINDOW_MINUTES)
    .max(SMART_WAKE_MAX_WINDOW_MINUTES)
    .default(SMART_WAKE_DEFAULT_WINDOW_MINUTES),
}).strict();

export const RecurringAlarmSchema = z.object({
  id: z.string().min(1),
  time: TimeSchema,
  recurrence: RecurrenceSchema,
  vibration: VibrationSchema,
  // Start stepping toward the wake temperature this many minutes before the
  // alarm. Omitted / undefined means no warm ramp.
  warmRampMinutes: z.number().int().min(0).max(180).optional(),
  // Wake temperature the warm ramp targets. Optional; falls back to the side's
  // power onTemperature when absent so old rows without it still ramp sanely.
  warmRampTargetF: TemperatureSchema.optional(),
  // Smart wake (Sleep Cycle-style). Optional; absent => disabled. Existing
  // alarm rows without this key parse unchanged.
  smartWake: SmartWakeSchema.optional(),
  enabled: z.boolean(),
}).strict();

// Unlimited per the fork's headline feature, but bounded to keep a hand-edited
// or corrupted file from arming thousands of node-schedule jobs. Comfortably
// above any real use.
export const MAX_RECURRING_ALARMS = 100;
export const RecurringAlarmsSchema = z.array(RecurringAlarmSchema).max(MAX_RECURRING_ALARMS);

// Top-level container persisted in its own LowDB file (recurringAlarmsDB.json),
// kept separate from schedulesDB so the day-of-week iteration over
// SideSchedule elsewhere in the codebase stays untouched.
export const RecurringAlarmsDbSchema = z.object({
  left: RecurringAlarmsSchema,
  right: RecurringAlarmsSchema,
}).strict();
export type RecurringAlarmsDb = z.infer<typeof RecurringAlarmsDbSchema>;



export const DailyScheduleSchema = z.object({
  temperatures: z.record(
    TimeSchema,
    TemperatureSchema,
  ),
  alarm: AlarmScheduleSchema,
  alarms: AlarmSchedulesSchema,
  power: z.object({
    on: TimeSchema,
    off: TimeSchema,
    onTemperature: TemperatureSchema,
    enabled: z.boolean(),
  }),
}).strict();

// Define the SideSchedule schema
export const SideScheduleSchema = z.object({
  sunday: DailyScheduleSchema,
  monday: DailyScheduleSchema,
  tuesday: DailyScheduleSchema,
  wednesday: DailyScheduleSchema,
  thursday: DailyScheduleSchema,
  friday: DailyScheduleSchema,
  saturday: DailyScheduleSchema,
}).strict();


// Define the Schedules schema
export const SchedulesSchema = z.object({
  left: SideScheduleSchema,
  right: SideScheduleSchema,
}).strict();

// Body shape for POST /schedules. Built explicitly instead of calling
// deepPartial() on SchedulesSchema, because deepPartial recurses into the
// alarm objects too and makes `time` optional, so a timeless alarm used to
// validate and reach the scheduler. Temperatures and power stay patchable;
// an alarm is all-or-nothing.
export const DailyScheduleUpdateSchema = z.object({
  temperatures: DailyScheduleSchema.shape.temperatures,
  alarm: AlarmScheduleSchema,
  alarms: AlarmSchedulesSchema,
  power: DailyScheduleSchema.shape.power.partial(),
}).strict().partial();

export const SideScheduleUpdateSchema = z.object({
  sunday: DailyScheduleUpdateSchema,
  monday: DailyScheduleUpdateSchema,
  tuesday: DailyScheduleUpdateSchema,
  wednesday: DailyScheduleUpdateSchema,
  thursday: DailyScheduleUpdateSchema,
  friday: DailyScheduleUpdateSchema,
  saturday: DailyScheduleUpdateSchema,
}).strict().partial();

export const SchedulesUpdateSchema = z.object({
  left: SideScheduleUpdateSchema,
  right: SideScheduleUpdateSchema,
}).strict().partial();

export type DailySchedule = z.infer<typeof DailyScheduleSchema>;
export type SchedulesUpdate = z.infer<typeof SchedulesUpdateSchema>;
export type SideSchedule = z.infer<typeof SideScheduleSchema>;
export type Schedules = z.infer<typeof SchedulesSchema>;
export type Alarm = z.infer<typeof AlarmSchema>;
export type AlarmJob = z.infer<typeof AlarmJobSchema>;
export type AlarmSchedule = z.infer<typeof AlarmScheduleSchema>;
export type AlarmSchedules = z.infer<typeof AlarmSchedulesSchema>;
export type Time = z.infer<typeof TimeSchema>;
export type Recurrence = z.infer<typeof RecurrenceSchema>;
export type Vibration = z.infer<typeof VibrationSchema>;
export type SmartWake = z.infer<typeof SmartWakeSchema>;
export type RecurringAlarm = z.infer<typeof RecurringAlarmSchema>;
export type RecurringAlarms = z.infer<typeof RecurringAlarmsSchema>;

// eslint-disable-next-line @typescript-eslint/no-type-alias
export type DayOfWeek = keyof SideSchedule;
// eslint-disable-next-line @typescript-eslint/no-type-alias
// export type Side = keyof Schedules;
export type Side = z.infer<typeof SideSchema>;
