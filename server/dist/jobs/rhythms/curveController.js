import { effectiveCoolStart, levelAt, phaseAt, } from '../../db/smartCurve.js';
import { PRESENCE_STALE_MS } from '../../8sleep/presenceStale.js';
import logger from '../../logger.js';
import { bridgeDropouts, CAP_MS, coolStartOverride, presenceRun, stepStart, upEarlyDue, WINDOW_BEFORE_MS, } from './confirmation.js';
const MINUTE = 60_000;
export const MANUAL_HOLD_MAX_MS = 3 * 60 * MINUTE;
export const AFTER_WAKE_MS = 30 * MINUTE;
export const EXIT_COUNT_WINDOW_MS = 60 * MINUTE;
const LOOKBACK_MS = 24 * 60 * MINUTE;
const LOOKAHEAD_MS = MANUAL_HOLD_MAX_MS;
const SIDES = ['left', 'right'];
const otherSide = (side) => (side === 'left' ? 'right' : 'left');
// The pre-warm and bedtime are one stretch at the bedtime level, up to the cool-down.
const stretchOf = (phase) => (phase === 'bedtime' ? 'prewarm' : phase);
// A manual change holds until the curve's next phase starts, at most 3 hours,
// and never past the power off.
export function holdEnd(points, from, powerOff) {
    const time = from.getTime();
    const current = phaseAt(points, from);
    const next = current === null
        ? undefined
        : points.find(point => point.at.getTime() > time && stretchOf(point.phase) !== stretchOf(current));
    return new Date(Math.min(next?.at.getTime() ?? Infinity, time + MANUAL_HOLD_MAX_MS, powerOff.getTime()));
}
const keyOf = (side, date) => `${side}-${date}`;
export class CurveController {
    deps;
    states = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    coolStartFor(side, date) {
        const state = this.states.get(keyOf(side, date));
        return state ? coolStartOverride(state.start, state.bedtime) : undefined;
    }
    gate(side, date, at) {
        const state = this.states.get(keyOf(side, date));
        if (!state)
            return 'run';
        const time = at.getTime();
        if (state.hold && time < state.hold.until.getTime())
            return 'hold';
        if (state.upEarlyAt && time >= state.upEarlyAt.getTime() && time <= state.wake.getTime())
            return 'base';
        if (state.outOfBedAt && time >= state.outOfBedAt.getTime() && time < state.wake.getTime() + AFTER_WAKE_MS)
            return 'base';
        return 'run';
    }
    noteManualChange(side, now) {
        const away = this.deps.awayMode();
        const driving = away[side] && !away[otherSide(side)] ? otherSide(side) : side;
        if (away[driving])
            return 'not-smart';
        const time = now.getTime();
        const sleeps = this.deps.sleeps(driving, new Date(time - LOOKBACK_MS), new Date(time + LOOKAHEAD_MS));
        const current = sleeps.find(sleep => sleep.start.getTime() <= time && time < sleep.end.getTime());
        if (!current) {
            const next = sleeps
                .filter(sleep => sleep.start.getTime() > time)
                .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
            return next?.mode === 'smart' && next.start.getTime() - time <= MANUAL_HOLD_MAX_MS ? 'smart-ahead' : 'not-smart';
        }
        if (current.mode !== 'smart' || !current.smartCurve || !current.smart)
            return 'not-smart';
        const state = this.stateFor(current, current.smartCurve, current.smart);
        state.hold = { from: now, until: holdEnd(state.points, now, state.powerOff) };
        const phase = phaseAt(state.points, now) ?? 'prewarm';
        state.manualChanges[phase] = (state.manualChanges[phase] ?? 0) + 1;
        logger.info(`smart schedule ${driving} ${current.date}: manual change holds until ${state.hold.until.toISOString()}`);
        return 'held';
    }
    status(side, now) {
        const time = now.getTime();
        for (const state of this.states.values()) {
            if (state.side !== side || time >= state.powerOff.getTime())
                continue;
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
    async tick() {
        const now = this.deps.now();
        const time = now.getTime();
        const away = this.deps.awayMode();
        const snapshot = this.deps.presence();
        const seen = new Set();
        for (const side of SIDES) {
            if (away[side])
                continue;
            const sleeps = this.deps.sleeps(side, new Date(time - LOOKBACK_MS), new Date(time + LOOKAHEAD_MS));
            for (const sleep of sleeps) {
                const curve = sleep.smartCurve;
                if (sleep.mode !== 'smart' || !curve || !sleep.smart)
                    continue;
                if (time < curve.bedtime.getTime() - WINDOW_BEFORE_MS || time >= sleep.end.getTime())
                    continue;
                const key = keyOf(side, sleep.date);
                // A paused night is not tracked; once the pause ends it is, as not observed if past its bedtime.
                if (this.deps.isPaused(side, now)) {
                    if (this.states.has(key))
                        seen.add(key);
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
            }
            else if (!seen.has(key)) {
                this.states.delete(key);
                // Jobs planned before this tick still use its moved start.
                const override = coolStartOverride(state.start, state.bedtime);
                if (override && override.getTime() !== state.bedtime.getTime())
                    this.deps.retime();
            }
        }
    }
    stateFor(sleep, curve, smart) {
        const key = keyOf(sleep.side, sleep.date);
        const existing = this.states.get(key);
        if (existing) {
            existing.rhythmId = sleep.rhythmId;
            existing.smart = smart;
            existing.daySleep = curve.daySleep;
            existing.wake = curve.wake;
            existing.powerOff = sleep.end;
            existing.points = curve.points;
            if (existing.bedtime.getTime() !== curve.bedtime.getTime())
                this.moveBedtime(existing, curve);
            // A cool-down start that presence moved moves the end of a hold with it.
            if (existing.hold)
                existing.hold.until = holdEnd(existing.points, existing.hold.from, existing.powerOff);
            return existing;
        }
        const state = {
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
    moveBedtime(state, curve) {
        const bedtime = curve.bedtime.getTime();
        const { start } = state;
        const keep = start.status === 'decided' && start.reason === 'confirmed' && start.confirmedAt !== null
            && start.confirmedAt.getTime() <= bedtime + CAP_MS
            && start.coolStart.getTime() === Math.max(bedtime, start.confirmedAt.getTime());
        state.bedtime = curve.bedtime;
        if (!keep)
            state.start = { status: 'watching' };
        // The jobs were planned with the old start, which curve.coolStart reflects.
        const coolStart = effectiveCoolStart(curve.bedtime, coolStartOverride(state.start, curve.bedtime) ?? curve.bedtime);
        if (coolStart.getTime() !== curve.coolStart.getTime())
            this.deps.retime();
    }
    sidesFor(side) {
        return this.deps.awayMode()[otherSide(side)] ? [...SIDES] : [side];
    }
    async step(state, snapshot, now) {
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
            if (moved)
                this.deps.retime();
        }
        state.firstSight = false;
        this.countExits(state, snapshot, sides, time);
        // A moved start leaves the points and hold end stale until the next tick re-resolves them.
        if (state.hold && !moved && time >= state.hold.until.getTime()) {
            state.hold = null;
            const level = levelAt(state.points, now);
            if (level !== null)
                await this.apply(state, level, 'manual hold ended');
        }
        if (state.hold)
            return;
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
    countExits(state, snapshot, sides, time) {
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
    async apply(state, level, why) {
        logger.info(`smart schedule ${state.side} ${state.date}: level ${level} (${why})`);
        try {
            await this.deps.applyLevel(state.side, level);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`smart schedule ${state.side} ${state.date}: could not set level: ${message}`);
        }
    }
    async finish(state) {
        const start = state.start.status === 'decided'
            ? state.start
            : { coolStart: state.bedtime, confirmedAt: null, reason: 'not-observed' };
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`smart schedule ${state.side} ${state.date}: history not recorded: ${message}`);
        }
    }
}
let active = null;
export function startCurveController(deps) {
    if (!active)
        active = new CurveController(deps);
    return active;
}
export function stopCurveController() {
    active = null;
}
export function smartCoolStartFor(side, date) {
    return active?.coolStartFor(side, date);
}
export function smartTemperatureGate(side, date, at) {
    return active ? active.gate(side, date, at) : 'run';
}
export function smartManualChange(side, now = new Date()) {
    return active ? active.noteManualChange(side, now) : 'not-smart';
}
export function smartCurveStatus(side, now = new Date()) {
    return active?.status(side, now) ?? null;
}
// The live night for the app. Holds stay in memory, so this is the only way
// the app can see one.
export function liveCurveState(side, now = new Date()) {
    const status = active?.status(side, now);
    if (!status)
        return null;
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
//# sourceMappingURL=curveController.js.map