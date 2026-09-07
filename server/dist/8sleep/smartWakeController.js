// Production wiring for the smart-wake state machine (smartWake.ts).
//
// Owns:
//   - the per-side active-session registry (at most one session per side),
//   - the ~30s tick timer for each active session (with an in-flight guard,
//     same discipline as buttonMonitor / the collector: every promise caught,
//     an unhandledRejection here would take down bed control),
//   - the concrete deps: reading biometrics/movement/presence, firing a
//     self-clearing nudge pulse, arming the pod vibrator, journaling.
//
// The session start is armed by alarmScheduler.ts at (alarmTime - window). The
// deadline alarm is a SEPARATE, independent node-schedule job; nothing here
// can cancel or delay it. This module only ADDS gentle early nudges.
import cbor from 'cbor';
import moment from 'moment-timezone';
import logger from '../logger.js';
import settingsDB from '../db/settings.js';
import servicesDB from '../db/services.js';
import { prisma } from '../db/prisma.js';
import { recordEvent } from '../db/collector.js';
import { getPresenceData } from '../routes/metrics/presence.js';
import { executeFunction } from './deviceApi.js';
import { armVibe } from '../jobs/armVibe.js';
import { SmartWakeSession, SMART_WAKE_TICK_MS, SMART_WAKE_STALE_VITALS_MS, } from './smartWake.js';
function errMsg(error) {
    return error instanceof Error ? error.message : String(error);
}
// How far back to pull biometrics each tick. A little wider than the staleness
// window so the freshest row is always in range even with clock skew.
const SNAPSHOT_LOOKBACK_MS = SMART_WAKE_STALE_VITALS_MS + 60_000;
const active = {};
// --- concrete deps ---------------------------------------------------------
async function readSnapshot(side) {
    const nowSec = Math.floor(Date.now() / 1000);
    const sinceSec = nowSec - Math.floor(SNAPSHOT_LOOKBACK_MS / 1000);
    // Biometrics stream health: mirror serverStatus.updateServices - a stream
    // timestamp older than 5 min is considered dead.
    await servicesDB.read();
    const stream = servicesDB.data.biometrics?.jobs?.stream;
    let biometricsHealthy = false;
    if (servicesDB.data.biometrics?.enabled && stream) {
        const streamAge = moment().diff(moment(stream.timestamp), 'minutes');
        biometricsHealthy = stream.status === 'healthy' && streamAge < 5;
    }
    const [vitals, movement] = await Promise.all([
        prisma.vitals.findMany({
            where: { side, timestamp: { gte: sinceSec, lte: nowSec } },
            orderBy: { timestamp: 'desc' },
            take: 10,
        }),
        prisma.movement.findMany({
            where: { side, timestamp: { gte: sinceSec, lte: nowSec } },
            orderBy: { timestamp: 'desc' },
            take: 10,
        }),
    ]);
    const presence = getPresenceData();
    const present = presence?.[side]?.present ?? null;
    return {
        vitals: vitals.map((v) => ({
            timestamp: v.timestamp,
            heart_rate: v.heart_rate,
            hrv: v.hrv,
            breathing_rate: v.breathing_rate,
        })),
        movement: movement.map((m) => ({ timestamp: m.timestamp, total_movement: m.total_movement })),
        present,
        biometricsHealthy,
    };
}
// A single self-clearing nudge pulse - the buttonMonitor.maybeHaptic pattern:
// send the ALARM command, then clear it shortly after so it's a brief buzz.
async function pulse(side, intensity, durationS) {
    await settingsDB.read();
    const payload = {
        pl: intensity,
        du: durationS,
        pi: 'double',
        tt: moment.tz(settingsDB.data.timeZone || 'UTC').unix(),
    };
    const hex = cbor.encode(payload).toString('hex');
    const command = side === 'left' ? 'ALARM_LEFT' : 'ALARM_RIGHT';
    await executeFunction(command, hex);
    // Clear after the pulse duration (+ small margin) so it never lingers as a
    // sustained alarm. Detached timer catches its own rejection.
    setTimeout(() => {
        void (async () => {
            try {
                await executeFunction('ALARM_CLEAR', 'empty');
            }
            catch (error) {
                logger.warn(`[smartWake] pulse clear failed (${side}): ${errMsg(error)}`);
            }
        })();
    }, durationS * 1000 + 500);
}
function makeDeps(side, entry) {
    return {
        now: () => Date.now(),
        readSnapshot: () => readSnapshot(side),
        pulse: (intensity, durationS) => pulse(side, intensity, durationS),
        wasDismissed: () => entry.dismissed,
        armVibe: () => armVibe(),
        journal: (event, payload) => {
            recordEvent('smart_wake', {
                side,
                payload: { event, ...payload },
                source: '8sleep/smartWakeController',
            });
        },
    };
}
// --- public API ------------------------------------------------------------
/**
 * Called by alarmScheduler at (alarmTime - windowMinutes) to begin a session.
 * Best-effort and self-guarded: any failure is logged and swallowed so it can
 * never abort the process or interfere with the independent deadline alarm.
 */
export async function startSmartWakeSession(params) {
    try {
        const side = params.side;
        // Only one session per side; a new one replaces any stale prior session.
        // eslint-disable-next-line no-use-before-define
        stopSmartWakeSession(side, 'superseded');
        const entry = {
            session: null,
            timer: null,
            inFlight: false,
            dismissed: false,
        };
        const deps = makeDeps(side, entry);
        entry.session = new SmartWakeSession(params, deps);
        active[side] = entry;
        await entry.session.start();
        // Tick immediately once, then on the interval. If the session ended during
        // the first tick (already awake, deadline, etc.), tear down.
        const runTick = async () => {
            if (entry.inFlight)
                return;
            entry.inFlight = true;
            try {
                await entry.session.tick();
            }
            catch (error) {
                logger.warn(`[smartWake] tick failed (${side}): ${errMsg(error)}`);
            }
            finally {
                entry.inFlight = false;
                if (entry.session.isEnded()) {
                    // eslint-disable-next-line no-use-before-define
                    stopSmartWakeSession(side, 'ended');
                }
            }
        };
        entry.timer = setInterval(() => { void runTick(); }, SMART_WAKE_TICK_MS);
        entry.timer.unref?.();
        await runTick();
    }
    catch (error) {
        logger.warn(`[smartWake] failed to start session (${params.side}): ${errMsg(error)}`);
    }
}
/**
 * Tear down the active session for a side (if any). `reason` is only for logs;
 * the session journals its own 'aborted'/terminal event.
 */
export function stopSmartWakeSession(side, reason = 'stopped') {
    const entry = active[side];
    if (!entry)
        return;
    if (entry.timer) {
        clearInterval(entry.timer);
        entry.timer = null;
    }
    // Abort journals only if the session hasn't already ended on its own.
    if (entry.session && !entry.session.isEnded()) {
        entry.session.abort();
    }
    delete active[side];
    logger.debug(`[smartWake] session torn down (${side}): ${reason}`);
}
/**
 * Hook the same dismissal path the middle cover button and the app use. Called
 * from updateDeviceStatus when isAlarmVibrating is set false. Marks the active
 * session (if any) as dismissed so its next tick ends 'woke_early'. Safe no-op
 * when no session is active.
 */
export function notifySmartWakeDismissed(side) {
    const entry = active[side];
    if (entry)
        entry.dismissed = true;
}
/** Test / shutdown helper: stop every active session. */
export function stopAllSmartWakeSessions() {
    for (const side of ['left', 'right']) {
        stopSmartWakeSession(side, 'shutdown');
    }
}
//# sourceMappingURL=smartWakeController.js.map