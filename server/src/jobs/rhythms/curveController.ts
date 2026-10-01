// Smart Schedule controller: in-memory per-sleep state for presence-confirmed
// cool-down starts, manual holds and up early. It never writes files; the
// engine re-resolves sleeps through smartCoolStartFor when a start moves.
import type { Side } from '../../db/schedulesSchema.js';
import {
  effectiveCoolStart, levelAt, phaseAt, type CurvePhase, type CurvePoint, type SmartCurveInfo,
} from '../../db/smartCurve.js';
import type { RhythmsLive, SmartSchedule } from '../../db/rhythmsSchema.js';
import { PRESENCE_STALE_MS } from '../../8sleep/presenceStale.js';
import logger from '../../logger.js';
import type { ResolvedSleep } from './resolve.js';
import {
  bridgeDropouts, CAP_MS, coolStartOverride, presenceRun, stepStart, upEarlyDue, WINDOW_BEFORE_MS,
  type KeptRun, type PresenceSnapshot, type SidePresence, type StartReason, type StartState,
} from './confirmation.js';

const MINUTE = 60_000;
export const MANUAL_HOLD_MAX_MS = 3 * 60 * MINUTE;
export const AFTER_WAKE_MS = 30 * MINUTE;
export const EXIT_COUNT_WINDOW_MS = 60 * MINUTE;
const LOOKBACK_MS = 24 * 60 * MINUTE;
const LOOKAHEAD_MS = MANUAL_HOLD_MAX_MS;
const SIDES: readonly Side[] = ['left', 'right'];

const otherSide = (side: Side): Side => (side === 'left' ? 'right' : 'left');
// The pre-warm and bedtime are one stretch at the bedtime level, up to the cool-down.
const stretchOf = (phase: CurvePhase): CurvePhase => (phase === 'bedtime' ? 'prewarm' : phase);

// A manual change holds until the curve's next phase starts, at most 3 hours,
// and never past the power off.
export function holdEnd(points: CurvePoint[], from: Date, powerOff: Date): Date {
  const time = from.getTime();
  const current = phaseAt(points, from);
  const next = current === null
    ? undefined
    : points.find(point => point.at.getTime() > time && stretchOf(point.phase) !== stretchOf(current));
  return new Date(Math.min(next?.at.getTime() ?? Infinity, time + MANUAL_HOLD_MAX_MS, powerOff.getTime()));
}
const keyOf = (side: Side, date: string) => `${side}-${date}`;

// What the controller knows about a finished sleep; history adds the onset estimate.
export type SleepSummary = {
  v: 1;
  side: Side;
  date: string;
  rhythmId: string | null;
  baseLevel: number;
  intensity: 'gentle' | 'standard';
  daySleep: boolean;
  plannedBedtime: string;
  plannedCoolStart: string;
  plannedWake: string;
  powerOff: string;
  coolStart: string;
  confirmedAt: string | null;
  startReason: StartReason;
  manualChanges: Partial<Record<CurvePhase, number>>;
  bedExitsLastHour: number;
  upEarlyAt: string | null;
  outOfBedAt: string | null;
};

export type CurveControllerDeps = {
  now: () => Date;
  presence: () => PresenceSnapshot;
  awayMode: () => Record<Side, boolean>;
  isPaused: (side: Side, now: Date) => boolean;
  // Every resolved sleep for the side intersecting [from, to], with smartCoolStartFor applied.
  sleeps: (side: Side, from: Date, to: Date) => ResolvedSleep[];
  applyLevel: (side: Side, level: number) => Promise<void>;
  retime: () => void;
  recordHistory: (summary: SleepSummary) => Promise<void>;
};

export type ManualChangeResult = 'held' | 'smart-ahead' | 'not-smart';
export type TemperatureGate = 'run' | 'hold' | 'base';
export type CurveStatus = {
  side: Side;
  date: string;
  phase: CurvePhase | null;
  start: StartState;
  coolStart: Date;
  holdUntil: Date | null;
  baseSince: Date | null;
  nextChange: { at: Date; level: number; phase: CurvePhase } | null;
};

type SleepState = {
  side: Side;
  date: string;
  rhythmId: string | null;
  smart: SmartSchedule;
  bedtime: Date;
  wake: Date;
  powerOff: Date;
  daySleep: boolean;
  points: CurvePoint[];
  start: StartState;
  firstSight: boolean;
  presence: KeptRun | null;
  hold: { from: Date; until: Date } | null;
  upEarlyAt: Date | null;
  outOfBedAt: Date | null;
  manualChanges: Partial<Record<CurvePhase, number>>;
  bedExitsLastHour: number;
  lastSeen: Partial<Record<Side, SidePresence>>;
};

export class CurveController {
  private readonly deps: CurveControllerDeps;
  private readonly states = new Map<string, SleepState>();

  constructor(deps: CurveControllerDeps) {
    this.deps = deps;
  }

  coolStartFor(side: Side, date: string): Date | undefined {
    const state = this.states.get(keyOf(side, date));
    return state ? coolStartOverride(state.start, state.bedtime) : undefined;
  }

  gate(side: Side, date: string, at: Date): TemperatureGate {
    const state = this.states.get(keyOf(side, date));
    if (!state) return 'run';
    const time = at.getTime();
    if (state.hold && time < state.hold.until.getTime()) return 'hold';
    if (state.upEarlyAt && time >= state.upEarlyAt.getTime() && time <= state.wake.getTime()) return 'base';
    if (state.outOfBedAt && time >= state.outOfBedAt.getTime() && time < state.wake.getTime() + AFTER_WAKE_MS) return 'base';
    return 'run';
  }

  noteManualChange(side: Side, now: Date): ManualChangeResult {
    const away = this.deps.awayMode();
    const driving = away[side] && !away[otherSide(side)] ? otherSide(side) : side;
    if (away[driving]) return 'not-smart';
    const time = now.getTime();
    const sleeps = this.deps.sleeps(driving, new Date(time - LOOKBACK_MS), new Date(time + LOOKAHEAD_MS));
    const current = sleeps.find(sleep => sleep.start.getTime() <= time && time < sleep.end.getTime());
    if (!current) {
      const next = sleeps
        .filter(sleep => sleep.start.getTime() > time)
        .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
      return next?.mode === 'smart' && next.start.getTime() - time <= MANUAL_HOLD_MAX_MS ? 'smart-ahead' : 'not-smart';
    }
    if (current.mode !== 'smart' || !current.smartCurve || !current.smart) return 'not-smart';

    const state = this.stateFor(current, current.smartCurve, current.smart);
    state.hold = { from: now, until: holdEnd(state.points, now, state.powerOff) };
    const phase = phaseAt(state.points, now) ?? 'prewarm';
    state.manualChanges[phase] = (state.manualChanges[phase] ?? 0) + 1;
    logger.info(`smart schedule ${driving} ${current.date}: manual change holds until ${state.hold.until.toISOString()}`);
    return 'held';
  }

  status(side: Side, now: Date): CurveStatus | null {
    const time = now.getTime();
    for (const state of this.states.values()) {
      if (state.side !== side || time >= state.powerOff.getTime()) continue;
      const level = levelAt(state.points, now);
      const next = state.points.find(point => point.at.getTime() > time && point.level !== level
        && this.gate(state.side, state.date, point.at) === 'run');
      return {
        side,
        date: state.date,
        phase: phaseAt(state.points, now),
        start: state.start,
        coolStart: coolStartOverride(state.start, state.bedtime) ?? state.bedtime,
        holdUntil: state.hold?.until ?? null,
        baseSince: state.upEarlyAt ?? state.outOfBedAt,
        nextChange: next ? { at: next.at, level: next.level, phase: next.phase } : null,
      };
    }
    return null;
  }

  async tick(): Promise<void> {
    const now = this.deps.now();
    const time = now.getTime();
    const away = this.deps.awayMode();
    const snapshot = this.deps.presence();
    const seen = new Set<string>();

    for (const side of SIDES) {
      if (away[side]) continue;
      const sleeps = this.deps.sleeps(side, new Date(time - LOOKBACK_MS), new Date(time + LOOKAHEAD_MS));
      for (const sleep of sleeps) {
        const curve = sleep.smartCurve;
        if (sleep.mode !== 'smart' || !curve || !sleep.smart) continue;
        if (time < curve.bedtime.getTime() - WINDOW_BEFORE_MS || time >= sleep.end.getTime()) continue;
        const key = keyOf(side, sleep.date);
        // A paused night is not tracked; once the pause ends it is, as not observed if past its bedtime.
        if (this.deps.isPaused(side, now)) {
          if (this.states.has(key)) seen.add(key);
          continue;
        }
        seen.add(key);
        const state = this.stateFor(sleep, curve, sleep.smart);
        await this.step(state, snapshot, now);
      }
    }

    for (const [key, state] of this.states) {
      if (time >= state.powerOff.getTime()) {
        this.states.delete(key);
        await this.finish(state);
      } else if (!seen.has(key)) {
        this.states.delete(key);
        // Jobs planned before this tick still use its moved start.
        const override = coolStartOverride(state.start, state.bedtime);
        if (override && override.getTime() !== state.bedtime.getTime()) this.deps.retime();
      }
    }
  }

  private stateFor(sleep: ResolvedSleep, curve: SmartCurveInfo, smart: SmartSchedule): SleepState {
    const key = keyOf(sleep.side, sleep.date);
    const existing = this.states.get(key);
    if (existing) {
      existing.rhythmId = sleep.rhythmId;
      existing.smart = smart;
      existing.daySleep = curve.daySleep;
      existing.wake = curve.wake;
      existing.powerOff = sleep.end;
      existing.points = curve.points;
      if (existing.bedtime.getTime() !== curve.bedtime.getTime()) this.moveBedtime(existing, curve);
      // A cool-down start that presence moved moves the end of a hold with it.
      if (existing.hold) existing.hold.until = holdEnd(existing.points, existing.hold.from, existing.powerOff);
      return existing;
    }
    const state: SleepState = {
      side: sleep.side,
      date: sleep.date,
      rhythmId: sleep.rhythmId,
      smart,
      bedtime: curve.bedtime,
      wake: curve.wake,
      powerOff: sleep.end,
      daySleep: curve.daySleep,
      points: curve.points,
      start: { status: 'watching' },
      firstSight: true,
      presence: null,
      hold: null,
      upEarlyAt: null,
      outOfBedAt: null,
      manualChanges: {},
      bedExitsLastHour: 0,
      lastSeen: {},
    };
    this.states.set(key, state);
    return state;
  }

  // An edited bedtime keeps a decided start only when the new bedtime gives
  // the same one; otherwise presence decides again against the new bedtime.
  private moveBedtime(state: SleepState, curve: SmartCurveInfo): void {
    const bedtime = curve.bedtime.getTime();
    const { start } = state;
    const keep = start.status === 'decided' && start.reason === 'confirmed' && start.confirmedAt !== null
      && start.confirmedAt.getTime() <= bedtime + CAP_MS
      && start.coolStart.getTime() === Math.max(bedtime, start.confirmedAt.getTime());
    state.bedtime = curve.bedtime;
    if (!keep) state.start = { status: 'watching' };
    // The jobs were planned with the old start, which curve.coolStart reflects.
    const coolStart = effectiveCoolStart(curve.bedtime, coolStartOverride(state.start, curve.bedtime) ?? curve.bedtime);
    if (coolStart.getTime() !== curve.coolStart.getTime()) this.deps.retime();
  }

  private sidesFor(side: Side): Side[] {
    return this.deps.awayMode()[otherSide(side)] ? [...SIDES] : [side];
  }

  private async step(state: SleepState, snapshot: PresenceSnapshot, now: Date): Promise<void> {
    const time = now.getTime();
    const sides = this.sidesFor(state.side);
    const run = presenceRun(snapshot, sides, time, PRESENCE_STALE_MS);
    const bridged = bridgeDropouts(state.presence, run, time);
    state.presence = bridged.kept;
    let moved = false;

    if (state.start.status !== 'decided') {
      const before = coolStartOverride(state.start, state.bedtime) ?? state.bedtime;
      state.start = stepStart(state.start, { run: bridged.run, bedtime: state.bedtime, now: time, firstSight: state.firstSight });
      const after = coolStartOverride(state.start, state.bedtime) ?? state.bedtime;
      if (state.start.status === 'decided') {
        logger.info(`smart schedule ${state.side} ${state.date}: cool-down from ${after.toISOString()} (${state.start.reason})`);
      }
      moved = before.getTime() !== after.getTime();
      if (moved) this.deps.retime();
    }
    state.firstSight = false;
    this.countExits(state, snapshot, sides, time);

    // A moved start leaves the points and hold end stale until the next tick re-resolves them.
    if (state.hold && !moved && time >= state.hold.until.getTime()) {
      state.hold = null;
      const level = levelAt(state.points, now);
      if (level !== null) await this.apply(state, level, 'manual hold ended');
    }
    if (state.hold) return;

    if (state.smart.upEarly && !state.upEarlyAt && upEarlyDue(run, state.wake, time)) {
      state.upEarlyAt = now;
      await this.apply(state, state.smart.baseLevel, 'up early');
      return;
    }
    const wake = state.wake.getTime();
    const outOfBed = !state.upEarlyAt && !state.outOfBedAt && run.known && run.presentSince === null
      && time >= wake && time < wake + AFTER_WAKE_MS && wake < state.powerOff.getTime();
    if (outOfBed) {
      state.outOfBedAt = now;
      await this.apply(state, state.smart.baseLevel, 'out of bed after wake');
    }
  }

  private countExits(state: SleepState, snapshot: PresenceSnapshot, sides: Side[], time: number): void {
    const wake = state.wake.getTime();
    const inWindow = time >= wake - EXIT_COUNT_WINDOW_MS && time <= wake;
    for (const side of sides) {
      const current = snapshot[side];
      const previous = state.lastSeen[side];
      const updated = current.lastUpdatedAt ? Date.parse(current.lastUpdatedAt) : Number.NaN;
      const fresh = Number.isFinite(updated) && time - updated <= PRESENCE_STALE_MS;
      if (inWindow && fresh && previous?.present
        && (!current.present || current.stateChangedAt !== previous.stateChangedAt)) {
        state.bedExitsLastHour += 1;
      }
      state.lastSeen[side] = { ...current };
    }
  }

  private async apply(state: SleepState, level: number, why: string): Promise<void> {
    logger.info(`smart schedule ${state.side} ${state.date}: level ${level} (${why})`);
    try {
      await this.deps.applyLevel(state.side, level);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`smart schedule ${state.side} ${state.date}: could not set level: ${message}`);
    }
  }

  private async finish(state: SleepState): Promise<void> {
    const start = state.start.status === 'decided'
      ? state.start
      : { coolStart: state.bedtime, confirmedAt: null, reason: 'not-observed' as const };
    try {
      await this.deps.recordHistory({
        v: 1,
        side: state.side,
        date: state.date,
        rhythmId: state.rhythmId,
        baseLevel: state.smart.baseLevel,
        intensity: state.smart.intensity,
        daySleep: state.daySleep,
        plannedBedtime: state.bedtime.toISOString(),
        plannedCoolStart: state.bedtime.toISOString(),
        plannedWake: state.wake.toISOString(),
        powerOff: state.powerOff.toISOString(),
        coolStart: start.coolStart.toISOString(),
        confirmedAt: start.confirmedAt?.toISOString() ?? null,
        startReason: start.reason,
        manualChanges: state.manualChanges,
        bedExitsLastHour: state.bedExitsLastHour,
        upEarlyAt: state.upEarlyAt?.toISOString() ?? null,
        outOfBedAt: state.outOfBedAt?.toISOString() ?? null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`smart schedule ${state.side} ${state.date}: history not recorded: ${message}`);
    }
  }
}

let active: CurveController | null = null;

export function startCurveController(deps: CurveControllerDeps): CurveController {
  if (!active) active = new CurveController(deps);
  return active;
}

export function stopCurveController(): void {
  active = null;
}

export function smartCoolStartFor(side: Side, date: string): Date | undefined {
  return active?.coolStartFor(side, date);
}

export function smartTemperatureGate(side: Side, date: string, at: Date): TemperatureGate {
  return active ? active.gate(side, date, at) : 'run';
}

export function smartManualChange(side: Side, now: Date = new Date()): ManualChangeResult {
  return active ? active.noteManualChange(side, now) : 'not-smart';
}

export function smartCurveStatus(side: Side, now: Date = new Date()): CurveStatus | null {
  return active?.status(side, now) ?? null;
}

// The live night for the app. Holds stay in memory, so this is the only way
// the app can see one.
export function liveCurveState(side: Side, now: Date = new Date()): RhythmsLive | null {
  const status = active?.status(side, now);
  if (!status) return null;
  return {
    side: status.side,
    date: status.date,
    phase: status.phase,
    waiting: status.start.status === 'waiting',
    coolStart: effectiveCoolStart(status.coolStart, status.coolStart).toISOString(),
    hold: status.holdUntil ? { until: status.holdUntil.toISOString() } : null,
    baseSince: status.baseSince?.toISOString() ?? null,
    nextChange: status.nextChange
      ? { at: status.nextChange.at.toISOString(), level: status.nextChange.level, phase: status.nextChange.phase }
      : null,
  };
}
