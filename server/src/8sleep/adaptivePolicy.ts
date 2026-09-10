/** Research-informed proposal engine. No device I/O; not an enabled controller.
 * Numerical limits are conservative engineering choices, not clinical targets.
 */
export type ThermalSide = 'left' | 'right';
export type ThermalPhase = 'settling' | 'middle' | 'late';
export type AdjustmentSource = 'physical-button' | 'app' | 'automatic' | 'schedule' | 'unknown';
export interface ThermalAdjustment {
  id: string;
  side: ThermalSide;
  source: AdjustmentSource;
  at: number;
  nightStart: number;
  fromF: number;
  toF: number;
  confirmed: boolean;
}
export interface ThermalContext {
  side: ThermalSide;
  now: number;
  nightStart: number;
  nightEnd: number;
  baselineF: number;
  minimumF: number;
  maximumF: number;
  targetF: number;
  enabled: boolean;
  isOn: boolean;
  asleep: boolean;
  away: boolean;
  priming: boolean;
  waterOkay: boolean;
  pumpHealthy: boolean;
  /** All inputs, including pump, presence and event monitoring, must be fresh. */
  telemetryAt: number;
  eventsComplete: boolean;
  /** Must survive restarts. Unknown history prevents automatic changes. */
  historyLoaded: boolean;
  lastAutomaticAt: number | null;
  adjustments: ThermalAdjustment[];
}
export type ThermalDecision =
  | { kind: 'hold'; reason: string }
  | { kind: 'propose'; targetF: number; reason: string; evidenceNights: number };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const validF = (value: number) => Number.isFinite(value) && value >= 55 && value <= 110;
const human = (source: AdjustmentSource) => source === 'physical-button' || source === 'app';

/** Elapsed-night buckets, deliberately not claims about REM/deep sleep. */
export function thermalPhase(elapsed: number): ThermalPhase {
  return elapsed < 120 * MINUTE ? 'settling' : elapsed < 300 * MINUTE ? 'middle' : 'late';
}

/** Use one final confirmed preference per night and phase, never button count.
 * Same-night reversals/conflicting preferences cannot become strong evidence.
 */
export function learnedPreference(context: ThermalContext): { targetF: number; nights: number } | null {
  const phase = thermalPhase(context.now - context.nightStart);
  const nights = new Map<number, ThermalAdjustment>();
  const seen = new Set<string>();
  for (const event of [...context.adjustments].sort((first, second) => first.at - second.at)) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.side !== context.side || !human(event.source) || !event.confirmed ||
        !validF(event.fromF) || !validF(event.toF) || Math.abs(event.toF - event.fromF) < 0.6 ||
        !Number.isFinite(event.nightStart) || !Number.isFinite(event.at) ||
        event.nightStart >= context.nightStart || event.nightStart < context.nightStart - 21 * DAY ||
        event.at < event.nightStart || event.at >= event.nightStart + 12 * 60 * MINUTE ||
        event.at >= context.nightStart || thermalPhase(event.at - event.nightStart) !== phase) continue;
    nights.set(event.nightStart, event);
  }
  const values = [...nights.values()].map(event => event.toF).sort((first, second) => first - second);
  if (values.length < 3 || values[values.length - 1] - values[0] > 2) return null;
  const middle = Math.floor(values.length / 2);
  return { targetF: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, nights: values.length };
}

export function proposeTemperature(context: ThermalContext): ThermalDecision {
  const hold = (reason: string): ThermalDecision => ({ kind: 'hold', reason });
  if (!context.enabled) return hold('disabled');
  if (![context.now, context.nightStart, context.nightEnd, context.telemetryAt].every(Number.isFinite) ||
      context.nightEnd <= context.nightStart || context.nightEnd - context.nightStart > 12 * 60 * MINUTE ||
      ![context.baselineF, context.minimumF, context.maximumF, context.targetF].every(validF) ||
      context.minimumF > context.baselineF || context.maximumF < context.baselineF ||
      (context.lastAutomaticAt !== null && (!Number.isFinite(context.lastAutomaticAt) || context.lastAutomaticAt > context.now))) {
    return hold('invalid-context');
  }
  if (context.now < context.nightStart || context.now >= context.nightEnd) return hold('outside-night');
  if (!context.historyLoaded || !context.eventsComplete) return hold('incomplete-history');
  // Intent pauses automation even when a manual command failed or did not move
  // the target. Unknown writes are held, but never labelled as button presses.
  if (context.adjustments.some(event => event.side === context.side &&
      (human(event.source) || event.source === 'unknown') &&
      event.at >= context.nightStart && event.at <= context.now)) return hold('manual-hold-until-night-end');
  if (context.telemetryAt > context.now || context.now - context.telemetryAt > 30_000) return hold('stale-telemetry');
  if (!context.isOn || !context.asleep || context.away || context.priming || !context.waterOkay || !context.pumpHealthy) {
    return hold('device-or-sleep-not-ready');
  }
  if (context.now - context.nightStart < 30 * MINUTE ||
      (context.lastAutomaticAt !== null && context.now - context.lastAutomaticAt < 30 * MINUTE)) return hold('settling');
  const preference = learnedPreference(context);
  if (!preference) return hold('insufficient-consistent-preferences');
  const lower = Math.max(context.minimumF, context.baselineF - 2);
  const upper = Math.min(context.maximumF, context.baselineF + 2);
  // Do not chase an unexpected target outside the experiment's comfort band.
  if (context.targetF < lower || context.targetF > upper) return hold('target-outside-comfort-band');
  const desired = Math.max(lower, Math.min(upper, Math.round(preference.targetF)));
  if (Math.abs(desired - context.targetF) < 0.6) return hold('at-preferred-temperature');
  // Whole-degree commands stay within 1°F even after hardware quantization.
  const candidate = desired > context.targetF
    ? Math.min(desired, Math.floor(context.targetF + 1))
    : Math.max(desired, Math.ceil(context.targetF - 1));
  if (candidate < lower || candidate > upper || Math.abs(candidate - context.targetF) < 0.6) {
    return hold('within-device-resolution');
  }
  return { kind: 'propose', targetF: candidate, evidenceNights: preference.nights,
    reason: 'repeated-manual-preference-in-this-night-phase' };
}
