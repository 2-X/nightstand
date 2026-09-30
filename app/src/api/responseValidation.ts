import { z } from 'zod';
import moment from 'moment-timezone';
import { DeviceStatusSchema, Version } from './deviceStatusSchema';
import { SettingsSchema } from './settingsSchema';
import {
  AlarmScheduleSchema, DailyScheduleSchema, SideScheduleSchema, SchedulesSchema, TemperatureSchema, TimeSchema,
} from './schedulesSchema';
import { ServicesSchema } from '../../../server/src/db/servicesSchema';
import { sleepRecordSchema } from './sleepSchema';
import { ChangelogResponseSchema } from './changelogSchema';
import { MemoryInfoSchema } from './memorySchema';
import { StorageInfoSchema } from './storageSchema';
import { StatusInfoSchema } from './serverStatusSchema';
import { vitalsRecordSchema } from '../../../server/src/db/vitalsRecordSchema';
import { movementRecordSchema } from '../../../server/src/db/movementRecordSchema';

import { responseSchema } from './responseSchema';

// Response compatibility: a field the app only displays, or can safely treat
// as unset, degrades on its own instead of failing the whole read. A field a
// control acts on or edits (temperatures the bed is set to, the on and off
// times, alarm times, away mode, override flags, daily priming) stays
// validated, since a made-up default there would be shown as fact or saved.
const soft = <T extends z.ZodTypeAny>(schema: T, fallback: z.output<T>) => responseSchema(schema).catch(fallback);

// Steps the app cannot draw or save are dropped, so one bad step cannot lock
// every day of the schedule. Saving the day rewrites it without them.
const temperaturesResponse = z.record(z.unknown()).transform(steps => {
  const kept = Object.entries(steps).filter(([time, temperature]) =>
    TimeSchema.safeParse(time).success && TemperatureSchema.safeParse(temperature).success);
  if (kept.length < Object.keys(steps).length) console.warn('Ignored invalid schedule temperature steps');
  return Object.fromEntries(kept);
});
const dailyResponse = DailyScheduleSchema.extend({
  temperatures: temperaturesResponse, alarms: z.array(AlarmScheduleSchema).default([]),
});
const sideResponse = SideScheduleSchema.extend(Object.fromEntries(
  Object.keys(SideScheduleSchema.shape).map(day => [day, dailyResponse]),
) as Record<keyof typeof SideScheduleSchema.shape, typeof dailyResponse>);

const sideSettingsShape = SettingsSchema.shape.left.shape;
const overrideShape = sideSettingsShape.scheduleOverrides.shape;
const sideSettingsResponse = SettingsSchema.shape.left.extend({
  name: soft(sideSettingsShape.name, ''),
  alarmsEnabled: soft(sideSettingsShape.alarmsEnabled.optional(), undefined),
  scheduleOverrides: z.object({
    temperatureSchedules: z.object({
      disabled: overrideShape.temperatureSchedules.shape.disabled,
      expiresAt: soft(overrideShape.temperatureSchedules.shape.expiresAt, ''),
    }),
    alarm: z.object({
      disabled: overrideShape.alarm.shape.disabled,
      timeOverride: soft(overrideShape.alarm.shape.timeOverride, ''),
      expiresAt: soft(overrideShape.alarm.shape.expiresAt, ''),
    }),
  }),
  oneOffAlarm: soft(sideSettingsShape.oneOffAlarm.optional(), undefined),
  taps: soft(sideSettingsShape.taps.optional(), undefined),
});
// The zone list is a picker, not a limit: any zone the app can format is kept.
const timeZoneResponse = z.string().refine(zone => !!moment.tz.zone(zone)).catch('UTC') as unknown as typeof SettingsSchema.shape.timeZone;
const settingsShape = SettingsSchema.shape;
const settingsResponse = SettingsSchema.extend({
  id: soft(settingsShape.id, ''),
  timeZone: timeZoneResponse,
  left: sideSettingsResponse,
  right: sideSettingsResponse,
  temperatureFormat: soft(settingsShape.temperatureFormat, 'fahrenheit'),
  rebootDaily: soft(settingsShape.rebootDaily.optional(), undefined),
  rawArchiveRetentionDays: soft(settingsShape.rawArchiveRetentionDays.optional(), undefined),
  updateChannel: soft(settingsShape.updateChannel.optional(), undefined),
  features: soft(z.object(Object.fromEntries(Object.entries(settingsShape.features.shape)
    .map(([key, flag]) => [key, soft(flag.optional(), undefined)]))).optional(), undefined),
});
const servicesResponse = ServicesSchema.extend({ biometrics: ServicesSchema.shape.biometrics.extend({
  jobs: ServicesSchema.shape.biometrics.shape.jobs.partial({ calibrateLeft: true, calibrateRight: true, pumpLeft: true, pumpRight: true }),
}) });

const seconds = z.number().finite().nonnegative();
const percentage = seconds.max(100);
const stages = <T extends z.ZodTypeAny>(value: T) => z.object({ awake: value, rem: value, light: value, deep: value });
const scoreComponent = z.object({ score: percentage, weight: seconds, value: z.string(), available: z.boolean() });
const presenceSide = z.object({
  present: z.boolean(),
  lastUpdatedAt: z.string().optional(),
  stateChangedAt: z.string().optional(),
  lastPresenceAt: z.string().optional(),
});
const calibrationSide = z.object({
  state: z.enum(['none', 'imported', 'calibrated']),
  summary: z.string(),
  quality: z.number().nullable(),
  calibratedAt: z.number().nullable(),
  lastRunStatus: z.string().nullable(),
});

// HTTP and WebSocket status reads share the same compatibility boundary. The
// bed controls need the temperatures, power and alarm state; hardware labels,
// Wi-Fi, water level and sensor readings are display-only.
const deviceSideResponse = DeviceStatusSchema.shape.left.extend({
  currentTemperatureLevel: soft(z.number().optional(), undefined),
  secondsRemaining: soft(z.number().optional(), undefined),
});
export const deviceStatusResponseSchema = responseSchema(DeviceStatusSchema.extend({
  left: deviceSideResponse,
  right: deviceSideResponse,
  waterLevel: soft(DeviceStatusSchema.shape.waterLevel.optional(), undefined),
  coverVersion: soft(DeviceStatusSchema.shape.coverVersion, Version.NotFound),
  hubVersion: soft(DeviceStatusSchema.shape.hubVersion, Version.NotFound),
  wifiStrength: soft(DeviceStatusSchema.shape.wifiStrength, 0),
  sensorTemps: soft(DeviceStatusSchema.shape.sensorTemps.optional(), undefined),
}));

// Validate a list row by row so one malformed record cannot hide the rest.
// A list where no row is usable still fails, which keeps a wholesale format
// change visible as an error instead of an empty history.
function rowsSchema(label: string, row: z.ZodTypeAny) {
  return z.array(z.unknown()).transform((rows, context) => {
    const kept = rows.flatMap(item => {
      const result = row.safeParse(item);
      return result.success ? [result.data as unknown] : [];
    });
    const dropped = rows.length - kept.length;
    if (dropped === 0) return kept;
    if (kept.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `No valid ${label} rows` });
      return z.NEVER;
    }
    console.warn(`Ignored ${dropped} invalid ${label} ${dropped === 1 ? 'row' : 'rows'}`);
    return kept;
  });
}

// Validate before responses reach query caches or controls. The Pod's schemas
// remain the source of truth; local schemas cover responses with only TS types.
const responseSchemas: Record<string, z.ZodTypeAny> = {
  '/deviceStatus': deviceStatusResponseSchema,
  '/settings': responseSchema(settingsResponse),
  '/schedules': responseSchema(SchedulesSchema.extend({ left: sideResponse, right: sideResponse })),
  '/services': responseSchema(servicesResponse),
  '/metrics/sleep': rowsSchema('sleep', sleepRecordSchema.refine(record => record.sleep_period_seconds >= 0
    && Date.parse(record.left_bed_at) >= Date.parse(record.entered_bed_at), 'Invalid sleep interval')),
  // Reads accept any recorded value; charts drop empty and non-positive ones.
  '/metrics/vitals': rowsSchema('vitals', vitalsRecordSchema.extend({
    heart_rate: z.number().nullable(), hrv: z.number().nullable(), breathing_rate: z.number().nullable(),
  })),
  '/metrics/movement': movementRecordSchema.array(),
  '/metrics/vitals/summary': z.object({
    avgHeartRate: seconds,
    minHeartRate: seconds,
    maxHeartRate: seconds,
    avgHRV: seconds,
    avgBreathingRate: seconds,
  }),
  '/metrics/sleep-stages': z.object({
    active: z.boolean(), epochs: z.array(z.object({ startUnix: seconds, endUnix: seconds, stage: z.enum(['awake', 'rem', 'light', 'deep']) })),
    totals: stages(seconds), percentages: stages(percentage), totalSeconds: seconds, lowCoverage: z.boolean().optional(),
  }),
  '/metrics/sleep-score': z.object({
    active: z.boolean(), score: percentage.nullable(),
    components: z.object({
      duration: scoreComponent.optional(),
      continuity: scoreComponent.optional(),
      hrv: scoreComponent.optional(),
      restingHr: scoreComponent.optional(),
    }),
  }),
  '/metrics/presence': z.object({ left: presenceSide, right: presenceSide }),
  '/calibration': z.object({ left: calibrationSide, right: calibrationSide }),
  '/logs': z.object({ logs: z.array(z.string()) }),
  '/changelog': ChangelogResponseSchema,
  '/memory': MemoryInfoSchema,
  '/storage': StorageInfoSchema,
  '/serverStatus': z.record(StatusInfoSchema).refine(status => Object.keys(status).length > 0, 'Missing status checks'),
  '/update/rollback-info': z.object({ available: z.boolean(), version: z.string().nullable().optional() }),
};

export function validateResponse(path: string, data: unknown): unknown {
  const schema = responseSchemas[path.split('?')[0]];
  return schema ? schema.parse(data) : data;
}
