import { z } from 'zod';
import {
  AlarmScheduleSchema, DailyScheduleUpdateSchema, DayOfWeek, MAX_ALARMS_PER_DAY, MAX_TEMPERATURES_PER_DAY, Schedules,
  SchedulesUpdateSchema, Side, SideScheduleUpdateSchema,
} from '../../db/schedulesSchema.js';

// Grandfather only the count already stored on this exact day. Validate inside
// the serialized write so concurrent edits cannot restore a larger old count.
export function scheduleUpdateSchema(existing: Schedules) {
  const sideSchema = (side: keyof Schedules) => SideScheduleUpdateSchema.extend(Object.fromEntries(
    Object.keys(SideScheduleUpdateSchema.shape).map(day => [day, DailyScheduleUpdateSchema.extend({
      alarms: z.array(AlarmScheduleSchema).max(Math.max(MAX_ALARMS_PER_DAY,
        existing[side][day as keyof Schedules['left']]?.alarms?.length ?? 0)).optional(),
    }).optional()]),
  ) as Record<keyof Schedules['left'], z.ZodOptional<typeof DailyScheduleUpdateSchema>>);
  return SchedulesUpdateSchema.extend({ left: sideSchema('left').optional(), right: sideSchema('right').optional() })
    .superRefine((update, ctx) => {
      for (const side of ['left', 'right'] as Side[]) {
        for (const [day, daily] of Object.entries(update[side] ?? {}) as [DayOfWeek, { temperatures?: object }][]) {
          if (!daily?.temperatures) continue;
          const stored = Object.keys(existing[side][day]?.temperatures ?? {}).length;
          if (Object.keys(daily.temperatures).length > Math.max(MAX_TEMPERATURES_PER_DAY, stored)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [side, day, 'temperatures'],
              message: `At most ${MAX_TEMPERATURES_PER_DAY} temperature changes per day`,
            });
          }
        }
      }
    });
}
