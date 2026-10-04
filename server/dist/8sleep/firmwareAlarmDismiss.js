import memoryDB from '../db/memoryDB.js';
import { activeAlarms, forgetActiveAlarm } from '../jobs/activeAlarms.js';
import logger from '../logger.js';
export function parseAlarmDismiss(raw) {
    const times = {};
    if (!raw)
        return times;
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return times;
        for (const [channel, side] of [['l', 'left'], ['r', 'right']]) {
            const timestamp = value[channel];
            if (typeof timestamp === 'number' && Number.isSafeInteger(timestamp) && timestamp >= 0) {
                times[side] = timestamp;
            }
        }
    }
    catch {
        return times;
    }
    return times;
}
// High-water marks follow alarm generations across connections.
const highestByAlarm = new WeakMap();
export class FirmwareAlarmDismiss {
    observations = new Map();
    connectionGeneration = 0;
    reset() {
        this.connectionGeneration += 1;
        this.observations.clear();
    }
    async observe(raw) {
        const connectionGeneration = this.connectionGeneration;
        const times = parseAlarmDismiss(raw);
        const dismissals = [];
        for (const side of ['left', 'right']) {
            const current = times[side];
            if (current === undefined)
                continue;
            const alarm = activeAlarms.get(side);
            const previous = this.observations.get(side);
            this.observations.set(side, { alarm, baseline: current });
            if (!alarm)
                continue;
            const highest = highestByAlarm.get(alarm) ?? current;
            highestByAlarm.set(alarm, Math.max(current, highest));
            if (previous?.alarm !== alarm)
                continue;
            if (current <= previous.baseline || current <= highest)
                continue;
            dismissals.push([side, alarm]);
        }
        if (dismissals.length === 0)
            return;
        await memoryDB.read();
        if (connectionGeneration !== this.connectionGeneration)
            return;
        const dismissed = [];
        for (const [side, alarm] of dismissals) {
            if (activeAlarms.get(side) !== alarm)
                continue;
            forgetActiveAlarm(side);
            memoryDB.data[side].isAlarmVibrating = false;
            dismissed.push(side);
        }
        if (dismissed.length === 0)
            return;
        await memoryDB.write();
        for (const side of dismissed) {
            logger.info(`Firmware dismissed the alarm on the ${side} side`);
        }
    }
}
//# sourceMappingURL=firmwareAlarmDismiss.js.map