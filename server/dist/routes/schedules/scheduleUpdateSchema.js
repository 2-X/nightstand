import { z } from 'zod';
import { AlarmScheduleSchema, DailyScheduleUpdateSchema, MAX_ALARMS_PER_DAY, SchedulesUpdateSchema, SideScheduleUpdateSchema, } from '../../db/schedulesSchema.js';
// Grandfather only the count already stored on this exact day. Validate inside
// the serialized write so concurrent edits cannot restore a larger old count.
export function scheduleUpdateSchema(existing) {
    const sideSchema = (side) => SideScheduleUpdateSchema.extend(Object.fromEntries(Object.keys(SideScheduleUpdateSchema.shape).map(day => [day, DailyScheduleUpdateSchema.extend({
            alarms: z.array(AlarmScheduleSchema).max(Math.max(MAX_ALARMS_PER_DAY, existing[side][day]?.alarms?.length ?? 0)).optional(),
        }).optional()])));
    return SchedulesUpdateSchema.extend({ left: sideSchema('left').optional(), right: sideSchema('right').optional() });
}
//# sourceMappingURL=scheduleUpdateSchema.js.map