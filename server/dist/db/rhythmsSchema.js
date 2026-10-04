// WARNING! - Any changes here MUST be the same between app/src/api & server/src/db/
import { z } from 'zod';
import { DailyScheduleSchema, SideSchema, TimeSchema } from './schedulesSchema.js';
// The update and rollback scripts skip the pre-stop handoff for a target that
// has the prepare-to-stop route, assuming it can continue a rhythm sleep. A
// new version here must keep that true or change that check.
export const RHYTHMS_FILE_VERSION = 1;
export const MAX_RHYTHMS_PER_SIDE = 12;
export const RhythmIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const SmartScheduleSchema = z.object({
    baseLevel: z.number().int().min(-10).max(10),
    intensity: z.enum(['gentle', 'standard']),
    warmStart: z.boolean(),
    warmUp: z.boolean(),
    upEarly: z.boolean(),
    // Turn off when the person gets up. Stored only when on; 3.5.0 drops it on
    // read and turns off at the set time.
    offWhenUp: z.boolean().optional(),
}).strict();
export const RhythmSchema = z.object({
    id: RhythmIdSchema,
    name: z.string().trim().min(1).max(24),
    // DailyScheduleSchema leaves power open, and POST /schedules relies on that.
    night: DailyScheduleSchema.extend({ power: DailyScheduleSchema.shape.power.strict() }),
    // When the person gets up, with or without an alarm.
    wake: TimeSchema,
    temperatureMode: z.enum(['manual', 'smart']),
    smart: SmartScheduleSchema,
}).strict();
export const WeekPlanSchema = z.object({
    sunday: RhythmIdSchema.nullable(),
    monday: RhythmIdSchema.nullable(),
    tuesday: RhythmIdSchema.nullable(),
    wednesday: RhythmIdSchema.nullable(),
    thursday: RhythmIdSchema.nullable(),
    friday: RhythmIdSchema.nullable(),
    saturday: RhythmIdSchema.nullable(),
}).strict();
export const DateChangeSchema = z.object({
    date: IsoDateSchema,
    rhythmId: RhythmIdSchema.nullable(),
}).strict();
export const SideRhythmsSchema = z.object({
    rhythms: z.record(RhythmIdSchema, RhythmSchema),
    week: WeekPlanSchema,
    changes: z.array(DateChangeSchema).max(120),
}).strict();
export const RhythmsDBSchema = z.object({
    version: z.literal(RHYTHMS_FILE_VERSION),
    legacyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    left: SideRhythmsSchema,
    right: SideRhythmsSchema,
}).strict();
// Body shape for POST /rhythms. A side that is sent replaces the stored side.
export const RhythmsUpdateSchema = z.object({
    left: SideRhythmsSchema.optional(),
    right: SideRhythmsSchema.optional(),
}).strict();
export const ACTIVATION_REASONS = ['flag-off', 'absent', 'invalid', 'unsupported-version', 'fingerprint-mismatch'];
export const RhythmsStatusSchema = z.object({
    enabled: z.boolean(),
    active: z.boolean(),
    reason: z.enum(ACTIVATION_REASONS).optional(),
}).strict();
export const RhythmsResponseSchema = z.object({
    status: RhythmsStatusSchema,
    data: RhythmsDBSchema.nullable(),
}).strict();
export const RhythmsSleepsQuerySchema = z.object({
    side: SideSchema,
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
}).strict();
export const DEFAULT_SMART = { baseLevel: 0, intensity: 'standard', warmStart: true, warmUp: true, upEarly: false };
// GET /rhythms/live: the running Smart Schedule night, read from memory.
export const CURVE_PHASES = ['prewarm', 'bedtime', 'cooldown', 'hold', 'warmup', 'wake', 'after'];
const InstantSchema = z.string().datetime({ offset: true });
// Set while a "When I get up" sleep runs and presence is fresh: the latest it turns off.
export const OffWhenUpLiveSchema = z.object({ by: InstantSchema }).strict();
export const RhythmsLiveSchema = z.object({
    side: SideSchema,
    date: IsoDateSchema,
    phase: z.enum(CURVE_PHASES).nullable(),
    waiting: z.boolean(),
    coolStart: InstantSchema,
    hold: z.object({ until: InstantSchema }).strict().nullable(),
    baseSince: InstantSchema.nullable(),
    nextChange: z.object({ at: InstantSchema, level: z.number().int(), phase: z.enum(CURVE_PHASES) }).strict().nullable(),
    offWhenUp: OffWhenUpLiveSchema.nullable().optional(),
}).strict();
export const RhythmsLiveResponseSchema = RhythmsLiveSchema.nullable();
export const RhythmsLiveQuerySchema = z.object({ side: SideSchema }).strict();
//# sourceMappingURL=rhythmsSchema.js.map