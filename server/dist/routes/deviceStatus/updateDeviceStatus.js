import _ from 'lodash';
import { adaptiveStore } from '../../8sleep/adaptiveState.js';
import { thermalQueue, thermalWriteContext, assertThermalWriteAllowed } from '../../8sleep/thermalQueue.js';
import { getDeviceStatusCoalesced } from '../../8sleep/frankenServer.js';
import cbor from 'cbor';
import { executeFunction } from '../../8sleep/deviceApi.js';
import logger from '../../logger.js';
import settingsDB from '../../db/settings.js';
import memoryDB from '../../db/memoryDB.js';
import { INVERTED_SETTINGS_KEY_MAPPING } from '../../8sleep/loadDeviceStatus.js';
import { recordEvent } from '../../db/collector.js';
import { notifySmartWakeDismissed } from '../../8sleep/smartWakeController.js';
// Inverse of loadDeviceStatus.ts's calculateTempInF. Same fixed firmware
// level scale, so the two files must be changed together.
const calculateLevelFromF = (temperatureF) => {
    const level = (temperatureF - 82.5) / 27.5 * 100;
    return Math.round(level).toString();
};
const updateSide = async (side, sideStatus) => {
    await settingsDB.read();
    const settings = settingsDB.data;
    if (side === 'left') {
        if (settings.left.awayMode) {
            logger.warn('Left side is in away mode, not updating side');
        }
    }
    else {
        if (settings.right.awayMode) {
            logger.warn('Right side is in away mode, not updating side');
        }
    }
    const controlBothSides = settings.left.awayMode || settings.right.awayMode;
    const updateLeft = side === 'left' || controlBothSides;
    const updateRight = side === 'right' || controlBothSides;
    const { isOn, targetTemperatureF, secondsRemaining, isAlarmVibrating } = sideStatus;
    if (controlBothSides) {
        logger.debug('One side is in away mode, updating both sides...');
    }
    if (isOn !== undefined) {
        const onDuration = isOn ? '43200' : '0';
        if (updateLeft)
            await executeFunction('LEFT_TEMP_DURATION', onDuration);
        if (updateRight)
            await executeFunction('RIGHT_TEMP_DURATION', onDuration);
    }
    if (targetTemperatureF !== undefined) {
        const level = calculateLevelFromF(targetTemperatureF);
        if (updateLeft)
            await executeFunction('TEMP_LEVEL_LEFT', level);
        if (updateRight)
            await executeFunction('TEMP_LEVEL_RIGHT', level);
    }
    if (secondsRemaining) {
        const seconds = Math.round(secondsRemaining).toString();
        if (updateLeft)
            await executeFunction('LEFT_TEMP_DURATION', seconds);
        if (updateRight)
            await executeFunction('RIGHT_TEMP_DURATION', seconds);
    }
    if (isAlarmVibrating !== undefined) {
        logger.debug('Can only set isAlarmVibrating to false for now...');
        if (!isAlarmVibrating) {
            await executeFunction('ALARM_CLEAR', 'empty');
            await memoryDB.read();
            // clearedEarly: the alarm was still vibrating (within its duration) when
            // the clear came in. If it wasn't vibrating, this is a no-op clear.
            const clearedEarly = memoryDB.data[side].isAlarmVibrating === true;
            // Record the dismissal instant so the deadline re-fire loop knows to
            // stop (isAlarmVibrating is also flipped by the per-duration self-clear
            // timer, so it cannot distinguish "buzz ended" from "user dismissed").
            memoryDB.data[side].lastAlarmDismissedAt = Date.now();
            recordEvent('alarm_cleared', {
                side,
                payload: { clearedEarly },
                source: 'routes/deviceStatus/updateDeviceStatus',
            });
            // Same dismissal path the middle cover button and the app use: end any
            // active smart-wake session on this side as woke_early. No-op when none.
            notifySmartWakeDismissed(side);
        }
        else {
            await memoryDB.read();
        }
        memoryDB.data[side].isAlarmVibrating = false;
        await memoryDB.write();
    }
};
const updateSettings = async (settings) => {
    const renamedSettings = _.mapKeys(settings, (value, key) => INVERTED_SETTINGS_KEY_MAPPING[key] || key);
    const encodedBuffer = cbor.encode(renamedSettings);
    const hexString = encodedBuffer.toString('hex');
    await executeFunction('SET_SETTINGS', hexString);
};
const updateHardwareStatus = async (deviceStatus) => {
    logger.info(`Updating device status..`);
    if (deviceStatus.isPriming === true)
        await executeFunction('PRIME');
    else if (deviceStatus.isPriming === false)
        await executeFunction('STOP_PRIME');
    if (deviceStatus?.left)
        await updateSide('left', deviceStatus.left);
    if (deviceStatus?.right)
        await updateSide('right', deviceStatus.right);
    if (deviceStatus?.settings)
        await updateSettings(deviceStatus.settings);
    logger.info('Finished updating device status');
};
export const updateDeviceStatus = async (deviceStatus, source = 'system', allowed) => {
    const sides = ['left', 'right'].filter(side => deviceStatus[side]?.targetTemperatureF !== undefined ||
        deviceStatus[side]?.isOn !== undefined || deviceStatus[side]?.secondsRemaining !== undefined);
    // Away mode mirrors hardware writes; protect both sleepers when it is already known.
    if ((settingsDB.data.left.awayMode || settingsDB.data.right.awayMode) && sides.length) {
        if (!sides.includes('left'))
            sides.push('left');
        if (!sides.includes('right'))
            sides.push('right');
    }
    // Intent is synchronous, BEFORE waiting behind a read or another write.
    if (source !== 'automatic') {
        for (const side of sides) {
            if (source === 'app' || source === 'physical-button' || source === 'unknown')
                adaptiveStore.intent(side);
            else
                adaptiveStore.revision[side]++;
        }
    }
    await thermalQueue.run(() => thermalWriteContext.run({ source, allowed }, async () => {
        assertThermalWriteAllowed();
        let before;
        if (sides.some(side => deviceStatus[side]?.targetTemperatureF !== undefined)) {
            try {
                before = await getDeviceStatusCoalesced();
            }
            catch { /* Manual controls must remain available. */ }
        }
        assertThermalWriteAllowed();
        if (source === 'automatic' && (!before || !allowed?.(before) || before.isPriming || String(before.waterLevel) !== 'true' ||
            sides.some(side => !before[side].isOn || before[side].isAlarmVibrating))) {
            throw new Error('Fresh hardware state does not permit an automatic change');
        }
        for (const side of sides) {
            const target = deviceStatus[side]?.targetTemperatureF;
            if (target !== undefined && (!Number.isFinite(target) || target < 55 || target > 110))
                throw new Error('Invalid temperature');
            // A scheduled target owns the rest of the session; do not fight wake ramps.
            if (source === 'schedule' && adaptiveStore.data[side].session) {
                adaptiveStore.data[side].session.lastAutomaticAt = Date.now();
                adaptiveStore.save();
            }
            if (source === 'system' && target !== undefined && adaptiveStore.data[side].session) {
                adaptiveStore.data[side].holdUntil = adaptiveStore.data[side].session.end;
                adaptiveStore.save();
            }
        }
        await updateHardwareStatus(deviceStatus);
        if (before) {
            // This read is queued after the write; no optimistic UI values are used.
            let after;
            try {
                await getDeviceStatusCoalesced();
                after = await getDeviceStatusCoalesced();
            }
            catch { /* Unconfirmed observations never train. */ }
            for (const side of sides) {
                const target = deviceStatus[side]?.targetTemperatureF;
                if (target === undefined)
                    continue;
                const confirmed = !!after && Math.abs(after[side].targetTemperatureF - target) < 0.6;
                adaptiveStore.data[side].expectedF = confirmed ? after[side].targetTemperatureF : null;
                adaptiveStore.record(side, source === 'system' ? 'schedule' : source, before[side].targetTemperatureF, after?.[side].targetTemperatureF ?? target, confirmed);
                if (source === 'automatic' && !confirmed) {
                    adaptiveStore.intent(side);
                    throw new Error('Automatic temperature was not confirmed; paused for this night');
                }
            }
        }
    }));
};
//# sourceMappingURL=updateDeviceStatus.js.map