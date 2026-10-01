import { z } from 'zod';
import { AlarmScheduleSchema, DailyScheduleSchema } from './schedulesSchema';
import {
  ACTIVATION_REASONS, CURVE_PHASES, IsoDateSchema, RhythmsDBSchema, RhythmsLiveSchema, RhythmsResponseSchema, RhythmsStatusSchema,
  SmartScheduleSchema,
} from './rhythmsSchema';
import { responseSchema } from './responseSchema';

export type { RhythmsLive, RhythmsResponse, RhythmsStatus } from './rhythmsSchema';

const instant = z.string().refine(value => Number.isFinite(Date.parse(value)), 'Invalid time');
const side = z.enum(['left', 'right']);
const temperatureEvent = <K extends 'power-on' | 'temperature'>(kind: K) =>
  z.object({ kind: z.literal(kind), at: instant, temperatureF: z.number().finite() });

const KnownEventSchema = z.discriminatedUnion('kind', [
  temperatureEvent('power-on'),
  temperatureEvent('temperature'),
  z.object({ kind: z.literal('alarm'), at: instant, alarm: responseSchema(AlarmScheduleSchema), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('power-off'), at: instant }),
]);
export type SleepEvent = z.infer<typeof KnownEventSchema>;

// A newer Pod may add event kinds; skip them rather than fail the page.
const EventsSchema = z.array(z.unknown()).transform(items => items.flatMap(item => {
  const parsed = KnownEventSchema.safeParse(item);
  return parsed.success ? [parsed.data] : [];
}));

// Later versions may add reasons and curve phases; an unknown one reads as none.
const phase = z.enum(CURVE_PHASES).nullable().catch(null);

// A Smart Schedule sleep's curve, with its bedtime and wake time; a curve this app cannot read is left out.
const SmartCurveSchema = z.object({
  bedtime: instant,
  coolStart: instant,
  wake: instant,
  daySleep: z.boolean(),
  points: z.array(z.object({ at: instant, level: z.number().int(), phase })),
});

export const ResolvedSleepResponseSchema = z.object({
  side,
  date: IsoDateSchema,
  rhythmId: z.string().nullable(),
  start: instant,
  end: instant,
  wake: instant.optional(),
  night: responseSchema(DailyScheduleSchema.extend({ alarms: z.array(AlarmScheduleSchema).default([]) })),
  mode: z.enum(['manual', 'smart']).catch('manual'),
  smart: responseSchema(SmartScheduleSchema).optional(),
  smartCurve: SmartCurveSchema.optional().catch(undefined),
  events: EventsSchema,
});
export const ResolvedSleepsResponseSchema = z.array(ResolvedSleepResponseSchema);
export type ResolvedSleepResponse = z.infer<typeof ResolvedSleepResponseSchema>;

// The server's schemas, read with unknown keys stripped. A file this app
// cannot read (a newer version) shows as no data instead of failing the page.
const reason = z.enum(ACTIVATION_REASONS).optional().catch(undefined);
export const RhythmsResponseReadSchema = responseSchema(RhythmsResponseSchema).extend({
  status: responseSchema(RhythmsStatusSchema).extend({ reason }),
  data: responseSchema(RhythmsDBSchema).nullable().catch(null),
});
export const RhythmsLiveReadSchema = responseSchema(RhythmsLiveSchema).extend({
  phase,
  nextChange: responseSchema(RhythmsLiveSchema.shape.nextChange.unwrap()).nullable().catch(null),
}).nullable();

// deviceUpdateFailed: the flag and settings were saved, but the Pod did not take that side's device write.
export const HandoffReportSchema = z.object({
  sides: z.array(z.object({
    side, action: z.string(), until: z.string().optional(), alarmOverrideSet: z.boolean().optional(),
    deviceUpdateFailed: z.boolean().optional(),
  })),
});
export type HandoffReport = z.infer<typeof HandoffReportSchema>;

export const EnableResponseSchema = z.object({ converted: z.boolean() });
