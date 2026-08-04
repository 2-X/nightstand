// Per-side presence-based auto-off.
//
// If a side has been ON without any reported presence for PRESENCE_AUTO_OFF_MS,
// we turn it off automatically. Acts independently per side. Skipped while a
// side is in awayMode. The grace period from "user just turned the side on"
// counts toward the timeout - if the user turns the side on but never lays
// down, we still shut it off after the timeout elapses.
//
// IMPORTANT: skipped while we're inside the user's explicit power schedule's
// on-window. Without this guard, a noisy partner can starve the dominance
// arbiter on the lighter sleeper's side (decision_L=False because
// R-signal >> L-signal), causing the algorithm to treat the user as
// not-present for >45 min mid-sleep and silently shut the bed off at 3 AM
// even though they're peacefully asleep. The schedule is the user's
// declarative intent ("keep this side on until 09:50"); the presence heuristic
// is only a safety net for naps and forgot-to-turn-off cases outside that
// window.
import moment from 'moment-timezone';
import logger from '../logger.js';
import schedulesDB from '../db/schedules.js';
import settingsDB from '../db/settings.js';
import { getPresenceData } from '../routes/metrics/presence.js';
import { getDeviceStatusCoalesced } from './frankenServer.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { scheduleWrapsToNextDay } from '../jobs/utils.js';
export const PRESENCE_AUTO_OFF_MS = 45 * 60 * 1000;
// Matches the presence stream's own ~once-a-minute heartbeat cadence, so a
// tighter poll wouldn't see any new information between checks.
const CHECK_INTERVAL_MS = 60 * 1000;
// The presence stream heartbeats about once a minute. If its last report is
// older than this we cannot tell "the bed is empty" from "nothing is
// reporting" (biometrics turned off, stream crashed, service restarting), so
// presence is UNKNOWN and auto-off must hold rather than guess.
export const PRESENCE_STALE_MS = 5 * 60 * 1000;
// The pod can boot with a wrong clock and NTP-step it later. A gap between
// ticks far larger than the interval means the wall clock jumped, not that
// time passed, so elapsed idle times computed against it are meaningless.
const CLOCK_STEP_MS = 5 * CHECK_INTERVAL_MS;
// Per-side tracking. We need the on-transition timestamp because the
// presence stream may not have emitted any "present" event for a side that
// was never occupied - without this we'd auto-off immediately on a fresh
// power-on. We also avoid firing repeatedly for the same idle session.
const lastSeenOnAt = { left: null, right: null };
const prevIsOn = { left: null, right: null };
let lastTickAt = null;
let timer = null;
/**
 * Returns true if `now` falls inside an enabled power schedule's on-window for
 * the given side. A window opens at power.on on its own day and closes at
 * power.off, which lands on the next day when it is not strictly later than
 * power.on (see `scheduleWrapsToNextDay`). Checking the windows opened by both
 * yesterday and today covers overnight schedules without special-casing them.
 */
function isInActivePowerSchedule(side, now, schedules) {
    const parseAt = (anchor, hhmm) => {
        const [h, m] = hhmm.split(':').map(Number);
        return anchor.clone().startOf('day').hour(h).minute(m).second(0).millisecond(0);
    };
    for (const daysAgo of [1, 0]) {
        const anchor = now.clone().subtract(daysAgo, 'day');
        const dayName = anchor.format('dddd').toLowerCase();
        const daySchedule = schedules[side]?.[dayName];
        if (!daySchedule?.power.enabled)
            continue;
        const start = parseAt(anchor, daySchedule.power.on);
        const end = parseAt(anchor, daySchedule.power.off);
        if (scheduleWrapsToNextDay(daySchedule.power))
            end.add(1, 'day');
        if (now.isSameOrAfter(start) && now.isBefore(end))
            return true;
    }
    return false;
}
async function tick() {
    let status;
    try {
        status = await getDeviceStatusCoalesced();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`presenceAutoOff: skip tick (status fetch failed): ${msg}`);
        return;
    }
    await settingsDB.read();
    await schedulesDB.read();
    const presence = getPresenceData();
    const now = Date.now();
    const tz = settingsDB.data.timeZone || 'UTC';
    const nowMoment = moment.tz(now, tz);
    // A wall-clock jump (NTP correcting a bad boot clock) would otherwise read
    // as hours of absence and power a side off immediately. Rebase the
    // references and wait for the next tick to measure real elapsed time.
    const sinceLastTick = lastTickAt === null ? 0 : now - lastTickAt;
    const clockStepped = lastTickAt !== null && (sinceLastTick > CLOCK_STEP_MS || sinceLastTick < 0);
    lastTickAt = now;
    if (clockStepped) {
        logger.warn(`presenceAutoOff: clock stepped by ${Math.round(sinceLastTick / 1000)}s, skipping this tick`);
        for (const side of ['left', 'right']) {
            if (lastSeenOnAt[side] !== null)
                lastSeenOnAt[side] = now;
        }
        return;
    }
    for (const side of ['left', 'right']) {
        const isOn = !!status?.[side]?.isOn;
        if (isOn && !prevIsOn[side]) {
            lastSeenOnAt[side] = now;
        }
        if (!isOn) {
            lastSeenOnAt[side] = null;
        }
        prevIsOn[side] = isOn;
        if (!isOn)
            continue;
        if (settingsDB.data[side].awayMode)
            continue;
        // Respect the user's explicit power schedule. If we're inside their
        // declared on-window (e.g., 21:50 → 09:50 overnight), don't auto-off -
        // the schedule's own power-off job will handle shutdown at the right time.
        if (isInActivePowerSchedule(side, nowMoment, schedulesDB.data))
            continue;
        // If the live stream currently reports present, the user is on the bed
        // right now - don't even consider auto-off. The stream's hysteresis
        // (3-min stillness grace + 3-consecutive-elevated entry) already filters
        // jitter, so trusting it here is much more reliable than computing from
        // lastPresenceAt while the Python only POSTs on transitions.
        if (presence[side].present)
            continue;
        // "Not present" is only trustworthy while the stream is actually
        // reporting. A stale or missing lastUpdatedAt means presence is unknown,
        // not absent, so hold rather than shut off a bed someone may be in.
        const lastUpdatedAt = presence[side].lastUpdatedAt
            ? moment(presence[side].lastUpdatedAt).valueOf()
            : null;
        if (lastUpdatedAt === null || Number.isNaN(lastUpdatedAt) || now - lastUpdatedAt > PRESENCE_STALE_MS) {
            logger.debug(`presenceAutoOff: presence unknown for ${side} (stream not reporting), skipping`);
            continue;
        }
        const lastPresenceAt = presence[side].lastPresenceAt
            ? moment(presence[side].lastPresenceAt).valueOf()
            : null;
        // Reference = the most recent of (we noticed the side turned on) and
        // (last reported presence). Whichever happened most recently is the
        // start of the current "no-presence" window.
        const refs = [];
        if (lastSeenOnAt[side] !== null)
            refs.push(lastSeenOnAt[side]);
        if (lastPresenceAt !== null)
            refs.push(lastPresenceAt);
        if (refs.length === 0)
            continue;
        const ref = Math.max(...refs);
        if (now - ref > PRESENCE_AUTO_OFF_MS) {
            const idleMin = Math.round((now - ref) / 60_000);
            logger.info(`presenceAutoOff: turning off ${side}, no presence for ${idleMin} min`);
            try {
                await updateDeviceStatus({ [side]: { isOn: false } });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`presenceAutoOff: failed to turn off ${side}: ${msg}`);
            }
        }
    }
}
export function startPresenceAutoOff() {
    if (timer)
        return;
    logger.info(`presenceAutoOff: starting (timeout ${PRESENCE_AUTO_OFF_MS / 60_000}min, check every ${CHECK_INTERVAL_MS / 1_000}s)`);
    timer = setInterval(() => { void tick(); }, CHECK_INTERVAL_MS);
}
export function stopPresenceAutoOff() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
//# sourceMappingURL=presenceAutoOffMonitor.js.map