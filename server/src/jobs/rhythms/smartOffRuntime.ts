// Live reads and writes for "When I get up": the Pod, the job list and the
// settings. The controller stays free of them so it can be tested alone.
import type { DeepPartial } from 'ts-essentials';
import logger from '../../logger.js';
import settingsDB from '../../db/settings.js';
import type { DeviceStatus } from '../../routes/deviceStatus/deviceStatusSchema.js';
import { updateDeviceStatus } from '../../routes/deviceStatus/updateDeviceStatus.js';
import { getDeviceStatusCoalesced, isFrankenConnected } from '../../8sleep/frankenServer.js';
import { nightAlarmPending, rhythmNightAlarms } from '../alarmActivity.js';
import { nextReboot } from '../rebootTime.js';
import { armExtensionStep, handedBack } from './runEvent.js';
import { isAlarmOverridden } from './gates.js';
import type { SmartOffDeps } from './curveController.js';

export function smartOffRuntime(): SmartOffDeps {
  return {
    // A tick must not wait for a reconnect.
    sideIsOn: async side => {
      if (!isFrankenConnected()) return null;
      try {
        return (await getDeviceStatusCoalesced())[side].isOn;
      } catch {
        return null;
      }
    },
    // Scheduled work, like the engine's own power-off. Not awaited, so a
    // wait for the Pod never stalls a tick.
    powerOff: side => {
      if (handedBack()) return;
      const update = { [side]: { isOn: false } } as DeepPartial<DeviceStatus>;
      void updateDeviceStatus(update, { background: true }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`smart schedule: could not turn the ${side} side off: ${message}`);
      });
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`smart schedule: could not read the daily restart: ${message}`);
        return null;
      }
    },
  };
}
