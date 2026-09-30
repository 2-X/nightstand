import { z } from 'zod';
import { DeviceStatusSchema } from './deviceStatusSchema';
import { SettingsSchema } from './settingsSchema';
import { AlarmScheduleSchema, DailyScheduleSchema, SideScheduleSchema, SchedulesSchema } from './schedulesSchema';
import { ServicesSchema } from '../../../server/src/db/servicesSchema';
import { sleepRecordSchema } from './sleepSchema';
import { ChangelogResponseSchema } from './changelogSchema';
import { MemoryInfoSchema } from './memorySchema';
import { StorageInfoSchema } from './storageSchema';
import { StatusInfoSchema } from './serverStatusSchema';
import { vitalsRecordSchema } from '../../../server/src/db/vitalsRecordSchema';
import { movementRecordSchema } from '../../../server/src/db/movementRecordSchema';

import { responseSchema } from './responseSchema';

const dailyResponse = DailyScheduleSchema.extend({ alarms: z.array(AlarmScheduleSchema).default([]) });
const sideResponse = SideScheduleSchema.extend(Object.fromEntries(
  Object.keys(SideScheduleSchema.shape).map(day => [day, dailyResponse]),
) as Record<keyof typeof SideScheduleSchema.shape, typeof dailyResponse>);

const sideSettingsResponse = SettingsSchema.shape.left.partial({ oneOffAlarm: true, alarmsEnabled: true });
const settingsResponse = SettingsSchema.partial({ features: true, rebootDaily: true, rawArchiveRetentionDays: true, updateChannel: true })
  .extend({ left: sideSettingsResponse, right: sideSettingsResponse,
    features: SettingsSchema.shape.features.partial().optional() });
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

// HTTP and WebSocket status reads share the same compatibility boundary.
export const deviceStatusResponseSchema = responseSchema(DeviceStatusSchema.extend({
  sensorTemps: DeviceStatusSchema.shape.sensorTemps.optional(),
}));

// Validate before responses reach query caches or controls. The Pod's schemas
// remain the source of truth; local schemas cover responses with only TS types.
const responseSchemas: Record<string, z.ZodTypeAny> = {
  '/deviceStatus': deviceStatusResponseSchema,
  '/settings': responseSchema(settingsResponse),
  '/schedules': responseSchema(SchedulesSchema.extend({ left: sideResponse, right: sideResponse })),
  '/services': responseSchema(servicesResponse),
  '/metrics/sleep': sleepRecordSchema.refine(record => record.sleep_period_seconds >= 0
    && Date.parse(record.left_bed_at) >= Date.parse(record.entered_bed_at), 'Invalid sleep interval').array(),
  // Reads accept any recorded value; charts drop empty and non-positive ones.
  '/metrics/vitals': vitalsRecordSchema.extend({
    heart_rate: z.number().nullable(), hrv: z.number().nullable(), breathing_rate: z.number().nullable(),
  }).array(),
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
