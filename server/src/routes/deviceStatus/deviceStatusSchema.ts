// WARNING! - Any changes here MUST be the same between app/src/api & server/src/db/

import { z } from 'zod';

export const MIN_TEMPERATURE_F = 55;
export const MAX_TEMPERATURE_F = 110;

const SideStatusSchema = z.object({
  currentTemperatureLevel: z.number(),
  currentTemperatureF: z.number(),
  targetTemperatureF: z.number()
    .min(MIN_TEMPERATURE_F, { message: 'Temperature must be at least 55°F' })
    .max(MAX_TEMPERATURE_F, { message: 'Temperature cannot exceed 110°F' }),
  secondsRemaining: z.number(),
  isOn: z.boolean(),
  isAlarmVibrating: z.boolean(),
  taps: z.object({
    doubleTap: z.number(),
    tripleTap: z.number(),
    quadTap: z.number(),
  }).optional(),
}).strict();


const SensorTempsResponseSchema = z.object({
  ambientC: z.number().nullable(),
  ambientF: z.number().nullable(),
  heatsinkC: z.number().nullable(),
  leftC: z.number().nullable(),
  rightC: z.number().nullable(),
  lastUpdated: z.string().nullable(),
}).nullable();

export const DeviceStatusSchema = z.object({
  left: SideStatusSchema,
  right: SideStatusSchema,
  waterLevel: z.string(),
  isPriming: z.boolean(),
  settings: z.object({
    v: z.number(),
    gainLeft: z.number(),
    gainRight: z.number(),
    ledBrightness: z.number(),
  }),
  coverVersion: z.string(),
  hubVersion: z.string(),
  freeSleep: z.object({
    version: z.string(),
    branch: z.string(),
  }),
  wifiStrength: z.number(),
  sensorTemps: SensorTempsResponseSchema,
}).strict();

// The firmware's "on" duration: LEFT_TEMP_DURATION/RIGHT_TEMP_DURATION take
// whole seconds, and turning a side on sends 12 hours.
export const MAX_ON_DURATION_SECONDS = 43_200;
// The firmware's range for these is undocumented and the app sends back what
// the Pod reports (gains of 400 on a Pod 5), so only absurd values are refused.
const firmwareSettingSchema = z.number().int().min(0).max(2_147_483_647);

// Body of POST /deviceStatus. Fields that reach the firmware are bounded;
// read-only status fields are accepted so a client can send back what it
// read, and are ignored.
const SideStatusUpdateSchema = SideStatusSchema.extend({
  secondsRemaining: z.number().int().min(0).max(MAX_ON_DURATION_SECONDS),
}).strict().partial();

export const DeviceStatusUpdateSchema = DeviceStatusSchema.extend({
  left: SideStatusUpdateSchema,
  right: SideStatusUpdateSchema,
  settings: z.object({
    v: firmwareSettingSchema,
    gainLeft: firmwareSettingSchema,
    gainRight: firmwareSettingSchema,
    ledBrightness: z.number().int().min(0).max(100),
  }).strict().partial(),
}).strict().partial();

export type SideStatus = z.infer<typeof SideStatusSchema>;
export type DeviceStatusUpdate = z.infer<typeof DeviceStatusUpdateSchema>;
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export enum Version {
  NotFound = 'Version not found',
  Pod3 = 'Pod 3',
  Pod4 = 'Pod 4',
  Pod5 = 'Pod 5',
}
