// WARNING! - Any changes here MUST be the same between app/src/api & server/src/db/
import { z } from 'zod';
const SideStatusSchema = z.object({
    currentTemperatureF: z.number(),
    targetTemperatureF: z.number().min(55, { message: "Temperature must be at least 55°F" }).max(110, { message: "Temperature cannot exceed 110°F" }),
    secondsRemaining: z.number(),
    isOn: z.boolean(),
    isAlarmVibrating: z.boolean(),
}).strict();
export const DeviceStatusSchema = z.object({
    left: SideStatusSchema,
    right: SideStatusSchema,
    sensorLabel: z.string(),
    waterLevel: z.string(),
    isPriming: z.boolean(),
    settings: z.string(),
}).strict();
