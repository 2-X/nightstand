import { z } from 'zod';
import { AlarmScheduleSchema, DailyScheduleUpdateSchema, MAX_ALARMS_PER_DAY, MAX_TEMPERATURES_PER_DAY, SchedulesUpdateSchema, SideScheduleUpdateSchema, } from '../../db/schedulesSchema.js';
// Grandfather only the count already stored on this exact day. Validate inside
// the serialized write so concurrent edits cannot restore a larger old count.
export function scheduleUpdateSchema(existing) {
    const sideSchema = (side) => SideScheduleUpdateSchema.extend(Object.fromEntries(Object.keys(SideScheduleUpdateSchema.shape).map(day => [day, DailyScheduleUpdateSchema.extend({
            alarms: z.array(AlarmScheduleSchema).max(Math.max(MAX_ALARMS_PER_DAY, existing[side][day]?.alarms?.length ?? 0)).optional(),
        }).optional()])));
    return SchedulesUpdateSchema.extend({ left: sideSchema('left').optional(), right: sideSchema('right').optional() })
        .superRefine((update, ctx) => {
        for (const side of ['left', 'right']) {
            for (const [day, daily] of Object.entries(update[side] ?? {})) {
                if (!daily?.temperatures)
                    continue;
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
//# sourceMappingURL=scheduleUpdateSchema.js.map