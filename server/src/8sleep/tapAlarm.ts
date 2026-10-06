import logger from '../logger.js';
import memoryDB from '../db/memoryDB.js';
import type { Side } from '../db/schedulesSchema.js';
import type { SideSettings } from '../db/settingsSchema.js';
import { dismissAlarm } from './dismissAlarm.js';
import { activeAlarms, cancelSnooze, forgetActiveAlarm, hasSnooze, setSnooze } from '../jobs/activeAlarms.js';
import { executeAlarm } from '../jobs/alarmScheduler.js';

export type AlarmTap = Extract<SideSettings['taps']['doubleTap'], { type: 'alarm' }>;

// Same steps as a dismiss from the app.
async function stopAlarm(side: Side) {
  await dismissAlarm(side);
  forgetActiveAlarm(side);
  await memoryDB.read();
  memoryDB.data[side].isAlarmVibrating = false;
  await memoryDB.write();
}

// The Pod's status has no ringing flag, so "sounding" is this server's record
// of the alarm it started: set once the Pod accepts the alarm command and
// cleared when its duration runs out or it is dismissed. It also holds the
// settings that alarm started with. A server restart forgets it.
export async function handleAlarmTap(side: Side, tap: AlarmTap): Promise<void> {
  const ringing = activeAlarms.get(side);

  if (ringing && tap.behavior === 'dismiss') {
    logger.info(`[tap] Dismissing the alarm on the ${side} side`);
    await stopAlarm(side);
    return;
  }

  if (ringing) {
    logger.info(`[tap] Snoozing the alarm on the ${side} side for ${tap.snoozeDuration} s`);
    try {
      await stopAlarm(side);
    } finally {
      // Armed even if the stop failed: whoever snoozed still has to be woken.
      setSnooze(side, tap.snoozeDuration * 1_000, () => {
        const dueAt = Date.now();
        void executeAlarm({ side, ...ringing, force: true }, undefined, { background: true, dueAt })
          .then(ringMs => {
            if (!ringMs) logger.warn(`[tap] The snoozed alarm on the ${side} side did not ring`);
          })
          .catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[tap] The snoozed alarm on the ${side} side failed: ${message}`);
          });
      });
    }
    return;
  }

  // A pending snooze counts as the alarm, so a tap acts on it rather than on the idle side.
  if (hasSnooze(side)) {
    if (tap.behavior === 'dismiss') {
      logger.info(`[tap] Dismissing the snoozed alarm on the ${side} side`);
      cancelSnooze(side);
    } else {
      logger.info(`[tap] The alarm on the ${side} side is already snoozed`);
    }
    return;
  }

  if (tap.inactiveAlarmBehavior === 'none') {
    logger.info(`[tap] No alarm on the ${side} side, nothing to do`);
    return;
  }

  // Turning a side on or off from a tap waits for a tap editor in the app.
  logger.info(`[tap] No alarm on the ${side} side; the power action is not used yet, nothing to do`);
}
