import logger from '../../logger.js';
import settingsDB from '../../db/settings.js';
import { updateDeviceStatus } from '../../routes/deviceStatus/updateDeviceStatus.js';
import { getDeviceStatusCoalesced, isFrankenConnected } from '../../8sleep/frankenServer.js';
import { nightAlarmPending, rhythmNightAlarms } from '../alarmActivity.js';
import { nextReboot } from '../rebootTime.js';
import { armExtensionStep, handedBack } from './runEvent.js';
import { isAlarmOverridden } from './gates.js';
export function smartOffRuntime() {
    return {
        // A tick must not wait for a reconnect.
        sideIsOn: async (side) => {
            if (!isFrankenConnected())
                return null;
            try {
                return (await getDeviceStatusCoalesced())[side].isOn;
            }
            catch {
                return null;
            }
        },
        // A bounded wait for the Pod, as for the steps, so a tick never stalls long.
        powerOff: async (side) => {
            if (handedBack())
                return false;
            await updateDeviceStatus({ [side]: { isOn: false } }, {});
            return true;
        },
        armTimer: (side, until, latest) => armExtensionStep(side, until, latest),
        // The night's own alarm jobs do not count while an override skips them; the
        // one-time alarm and an override's replacement time always do.
        alarmPending: (side, night, until) => {
            const ofNight = rhythmNightAlarms(side, night.date);
            const own = `rhythm-${side}-${night.date}-alarm-`;
            const skipped = isAlarmOverridden(settingsDB.data, side, night, new Date());
            return nightAlarmPending(side, until, skipped ? name => ofNight(name) && !name.startsWith(own) : ofNight);
        },
        // A restart it cannot read counts as none, so a tick goes on.
        nextRestart: after => {
            try {
                return nextReboot(settingsDB.data, after);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`smart schedule: could not read the daily restart: ${message}`);
                return null;
            }
        },
    };
}
//# sourceMappingURL=smartOffRuntime.js.map